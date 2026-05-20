"""
==========================================================================
  BLE Indoor Localization — Flask Backend  (trilateration build)
==========================================================================
  Positioning method: TRILATERATION — geometry from beacon coordinates +
  RSSI path-loss. No site survey; works at any location once beacon
  (x, y) coordinates are entered.

  Beacons (persistent registry on disk):
    GET    /beacons                  list all configured beacons
    POST   /beacons                  upsert one beacon
    DELETE /beacons/<id>             delete one
    POST   /beacons/clear            wipe registry

  Live tracking pipeline (raw RSSI -> trilateration -> 4D KF):
    POST   /fp/start                 begin tracking (optionally set sigma_a)
    POST   /fp/rssi/events           stream raw RSSI events
    GET    /fp/position/latest       latest smoothed (x, y) + velocity
    POST   /fp/reset                 reset cached RSSI + KF state
    GET    /fp/status                diagnostic snapshot
    POST   /fp/params                live-tune sigma_a (Q), R, smoothing
    GET/POST /fp/path                walkable-corridor polyline
    POST   /fp/route                 shortest route between two beacons

  Misc:
    GET    /health                   simple health check

  Route paths keep the legacy `/fp/` prefix so the frontend client does
  not need re-pathing; "fp" no longer means "fingerprint".
==========================================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from beacons import BeaconStore
from path_constraint import PathConstraint
from routing import compute_route
from tracking_pipeline import TrackingPipeline


app = Flask(__name__)
CORS(app)

# Persistent beacon registry — source of truth for anchor coordinates.
beacon_store = BeaconStore()

# Walkable-corridor polyline. Read by the pipeline to clamp the smoothed
# (x, y) onto the path; exposed over /fp/path for the frontend to edit.
path_constraint = PathConstraint()

# Trilateration-based live tracking pipeline. Beacon positions come from
# the registry — no survey required.
pipeline = TrackingPipeline(
    beacon_store=beacon_store,
    path_constraint=path_constraint,
)


# ---------- Health ----------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "method": "trilateration",
        "beacons": [b["name"] for b in beacon_store.list()],
    })


# ---------- Beacons (persistent registry on disk) ----------

@app.route("/beacons", methods=["GET"])
def beacons_list():
    """Return all configured beacons as {beacon_id: {id, name, x, y, ...}}."""
    return jsonify({"beacons": beacon_store.as_dict()})


@app.route("/beacons", methods=["POST"])
def beacons_upsert():
    """Add or update one beacon.

    Body:
        {"id": "AA:BB:CC:...", "name": "BCPro_0", "x": 0, "y": 0,
         "q": 0.7143, "r": 1.29,
         "uuid": "F7826DA6-4FA2-4E98-8024-BC5B71E0893E",
         "major": 1, "minor": 7}

    `q`, `r`, `uuid`, `major`, `minor` are optional. The (uuid, major,
    minor) triple is the iBeacon hardware identity configured in
    KBeaconPro; when present, the pipeline uses it as the primary match
    key so the beacon survives renames and iOS device.id drift.

    Returns the saved entry.
    """
    data = request.get_json(force=True) or {}
    bid = data.get("id")
    name = data.get("name") or bid
    try:
        x = float(data["x"])
        y = float(data["y"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "x and y are required numbers"}), 400
    if not bid:
        return jsonify({"error": "id is required"}), 400

    q = data.get("q")
    r = data.get("r")
    try:
        q_val = float(q) if q is not None else None
        r_val = float(r) if r is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "q and r must be numeric or null"}), 400

    uuid_raw = data.get("uuid")
    uuid_val = str(uuid_raw).strip() if uuid_raw else None
    major_raw = data.get("major")
    minor_raw = data.get("minor")
    try:
        major_val = int(major_raw) if major_raw not in (None, "") else None
        minor_val = int(minor_raw) if minor_raw not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "major/minor must be integers or null"}), 400

    entry = beacon_store.upsert(
        str(bid),
        str(name),
        x,
        y,
        q=q_val,
        r=r_val,
        uuid=uuid_val,
        major=major_val,
        minor=minor_val,
    )
    beacon_store.save()
    return jsonify({"status": "saved", "beacon": entry})


@app.route("/beacons/<path:beacon_id>", methods=["DELETE"])
def beacons_delete(beacon_id):
    removed = beacon_store.delete(beacon_id)
    if removed:
        beacon_store.save()
    return jsonify({"removed": removed})


@app.route("/beacons/clear", methods=["POST"])
def beacons_clear():
    beacon_store.clear()
    beacon_store.save()
    return jsonify({"status": "beacons cleared"})


# ---------- Event canonicalisation ----------

def _canonicalize_events(events: list) -> list:
    """Translate event `beacon_id` to the canonical id from `BeaconStore`.

    BLE scanners report a `device.id` (MAC on Android, system UUID on
    iOS) which can drift in case or across phone/Bluetooth-cache resets,
    and an advertised name the user can rewrite from KBeaconPro at any
    time. Each event is resolved to the configured `beacon_id` using the
    strongest identifier available, in priority order:

      1. iBeacon (uuid, major, minor) triple — STABLE across phones
         because it is burnt into the beacon by KBeaconPro.
      2. Case-insensitive advertised-name match.
      3. Case-insensitive `beacon_id` match (legacy single-phone path).

    Returns a fresh list — never mutates `events` in place.
    """
    registry = beacon_store.as_dict()
    by_name = {}
    by_upper_id = {}
    by_ibeacon = {}  # (uuid_upper, major, minor) -> canonical id
    for entry in registry.values():
        bid = entry.get("id")
        if not bid:
            continue
        bid_str = str(bid)
        nm = entry.get("name")
        if nm:
            by_name[str(nm).strip().lower()] = bid_str
        by_upper_id[bid_str.upper()] = bid_str
        u = entry.get("uuid")
        mj = entry.get("major")
        mn = entry.get("minor")
        if u and mj is not None and mn is not None:
            try:
                key = (str(u).upper(), int(mj) & 0xFFFF, int(mn) & 0xFFFF)
                by_ibeacon[key] = bid_str
            except (TypeError, ValueError):
                pass

    canonical = []
    for event in events:
        if not isinstance(event, dict):
            canonical.append(event)
            continue
        canonical_id = None

        u = event.get("ibeacon_uuid")
        mj = event.get("ibeacon_major")
        mn = event.get("ibeacon_minor")
        if u and mj is not None and mn is not None:
            try:
                key = (str(u).upper(), int(mj) & 0xFFFF, int(mn) & 0xFFFF)
                canonical_id = by_ibeacon.get(key)
            except (TypeError, ValueError):
                pass

        if canonical_id is None:
            beacon_name = event.get("beacon_name") or event.get("name")
            if beacon_name:
                canonical_id = by_name.get(str(beacon_name).strip().lower())

        if canonical_id is None:
            beacon_id = event.get("beacon_id") or event.get("id")
            if beacon_id is not None:
                canonical_id = by_upper_id.get(str(beacon_id).upper())

        if canonical_id is not None:
            canonical.append({**event, "beacon_id": canonical_id})
        else:
            canonical.append(event)
    return canonical


# ---------- Live tracking pipeline (raw RSSI -> trilateration -> 4D KF) -

@app.route("/fp/start", methods=["POST"])
def fp_start():
    """Begin a live tracking session.

    Body (all optional):
        {
            "sigma_a": 0.5,           // 4D KF process-noise std (m/s^2)
            "smoothing_window": 10    // # advertisements averaged/beacon
        }

    Resets the pipeline (clears cached RSSI + KF state) and applies any
    tuning passed in.
    """
    data = request.get_json(silent=True) or {}
    sigma_a = data.get("sigma_a")
    smoothing_window = data.get("smoothing_window")
    try:
        sa = float(sigma_a) if sigma_a is not None else None
        sw = int(smoothing_window) if smoothing_window is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "sigma_a must be numeric, smoothing_window an integer"}), 400
    if sa is not None or sw is not None:
        pipeline.set_params(sigma_a=sa, smoothing_window=sw)

    pipeline.reset()
    return jsonify({
        "status": "tracking started",
        "beacons": len(beacon_store.list()),
        **pipeline.get_status(),
    })


@app.route("/fp/rssi/events", methods=["POST"])
def fp_rssi_events():
    """Stream raw RSSI events into the pipeline.

    Body: { "events": [{"beacon_id": "...", "rssi": -67,
                         "beacon_name": "...", "ibeacon_uuid": "...",
                         "ibeacon_major": 1, "ibeacon_minor": 7}, ...] }

    Each event is canonicalised to a registered beacon (see
    _canonicalize_events). Events that still do not match any registered
    beacon are dropped, so unrelated BCPro advertisers in the same
    building cannot pollute the solver.
    """
    data = request.get_json(force=True) or {}
    events = data.get("events")
    if events is None and "beacon_id" in data and "rssi" in data:
        events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
    if not isinstance(events, list):
        return jsonify({"error": "events list required"}), 400

    canonical_events = _canonicalize_events(events)
    registered_ids = {
        str(entry.get("id")) for entry in beacon_store.list() if entry.get("id")
    }
    if registered_ids:
        filtered = [
            ev for ev in canonical_events
            if isinstance(ev, dict) and str(ev.get("beacon_id")) in registered_ids
        ]
        rejected_count = len(canonical_events) - len(filtered)
    else:
        filtered = canonical_events
        rejected_count = 0

    applied = pipeline.ingest_events(filtered)
    return jsonify({
        "applied": applied,
        "received": len(events),
        "rejected_unregistered": rejected_count,
    })


@app.route("/fp/position/latest", methods=["GET"])
def fp_position_latest():
    """Trilaterate from the latest RSSI and run the 4D KF. Returns
    ready=true with smoothed (x, y) + velocity, OR ready=false with a
    reason when fewer than 3 beacons are positioned / heard."""
    result = pipeline.update_position()
    if result is None:
        return jsonify({
            "ready": False,
            "reason": "no active beacons yet",
            "active_beacons": [],
        })
    if result.get("_insufficient"):
        n = result.get("anchor_count", 0)
        reason = (
            "beacons are collinear — position not determined"
            if result.get("degenerate")
            else f"need >= 3 positioned beacons in range, have {n}"
        )
        return jsonify({
            "ready": False,
            "reason": reason,
            "active_beacons": result.get("active_beacons", []),
            "anchor_count": n,
        })
    return jsonify({"ready": True, **result})


@app.route("/fp/reset", methods=["POST"])
def fp_reset():
    pipeline.reset()
    return jsonify({"status": "pipeline reset"})


@app.route("/fp/status", methods=["GET"])
def fp_status():
    return jsonify(pipeline.get_status())


@app.route("/fp/params", methods=["POST"])
def fp_params():
    """Live-tune the pipeline.

    Body (all optional):
        {
            "sigma_a": 0.7,               // 4D KF process-noise std
            "R": [[4.0, 0.0], [0.0, 4.0]],// 2x2 measurement noise (m^2)
            "smoothing_window": 10        // # advertisements averaged
        }
    """
    data = request.get_json(force=True) or {}
    sigma_a = data.get("sigma_a")
    r = data.get("R")
    smoothing_window = data.get("smoothing_window")
    try:
        sa = float(sigma_a) if sigma_a is not None else None
        sw = int(smoothing_window) if smoothing_window is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "sigma_a must be numeric, smoothing_window an integer"}), 400

    if r is not None:
        try:
            r_np = [[float(r[0][0]), float(r[0][1])],
                    [float(r[1][0]), float(r[1][1])]]
        except (TypeError, ValueError, IndexError):
            return jsonify({"error": "R must be a 2x2 matrix"}), 400
    else:
        r_np = None

    pipeline.set_params(sigma_a=sa, r=r_np, smoothing_window=sw)
    return jsonify({"status": "updated", **pipeline.get_status()})


@app.route("/fp/path", methods=["GET"])
def fp_path_get():
    """Return the walkable polyline used to clamp the smoothed position.
    Each segment is `{"x1","y1","x2","y2"}` in metres (beacon frame)."""
    return jsonify({"segments": path_constraint.segments()})


@app.route("/fp/path", methods=["POST"])
def fp_path_set():
    """Replace the polyline. Body: `{"segments": [...]}` — each segment
    accepted as `{"x1","y1","x2","y2"}`, `[x1,y1,x2,y2]`, or
    `[[x1,y1],[x2,y2]]`. An empty list disables the constraint."""
    data = request.get_json(force=True) or {}
    segments = data.get("segments")
    if not isinstance(segments, list):
        return jsonify({"error": "segments list required"}), 400
    path_constraint.set_segments(segments)
    try:
        path_constraint.save()
    except OSError as exc:
        return jsonify({"error": f"failed to persist path: {exc}"}), 500
    return jsonify({"status": "saved", "segments": path_constraint.segments()})


@app.route("/fp/route", methods=["POST"])
def fp_route():
    """Shortest walking route between two registered beacons, following
    the walkable-path polyline (/fp/path).

    Body: { "start_beacon_id": "...", "end_beacon_id": "..." }

    Returns the ordered waypoints + total length. `reachable` is false
    when there is no path polyline, or the two beacons are on
    disconnected path components — `waypoints` then degrades to a direct
    start->end line.
    """
    data = request.get_json(force=True) or {}
    start_id = data.get("start_beacon_id")
    end_id = data.get("end_beacon_id")
    if not start_id or not end_id:
        return jsonify({"error": "start_beacon_id and end_beacon_id are required"}), 400
    if str(start_id) == str(end_id):
        return jsonify({"error": "start and destination must be different beacons"}), 400

    start_b = beacon_store.get(str(start_id))
    end_b = beacon_store.get(str(end_id))
    if start_b is None or end_b is None:
        missing = "start" if start_b is None else "destination"
        return jsonify({"error": f"{missing} beacon is not registered"}), 404

    route = compute_route(
        path_constraint.segments(),
        (start_b["x"], start_b["y"]),
        (end_b["x"], end_b["y"]),
    )
    return jsonify({
        "start": {
            "id": start_b["id"], "name": start_b["name"],
            "x": start_b["x"], "y": start_b["y"],
        },
        "end": {
            "id": end_b["id"], "name": end_b["name"],
            "x": end_b["x"], "y": end_b["y"],
        },
        **route,
    })


# ---------- Run ----------

if __name__ == "__main__":
    print("=" * 60)
    print("  BLE Indoor Localization Backend — trilateration")
    print(f"  Beacons: {len(beacon_store.list())} configured")
    print(f"  Path:    {len(path_constraint.segments())} walkable segments")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True)
