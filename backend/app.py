"""
==========================================================================
  BLE Indoor Localization — Flask Backend
==========================================================================
  Beacons (persistent registry on disk):
    GET    /beacons                  list all configured beacons
    POST   /beacons                  upsert one beacon
    DELETE /beacons/<id>             delete one
    POST   /beacons/clear            wipe registry

  Site survey (fingerprint grid collection):
    POST   /survey/start             open a session at (x, y)
    POST   /survey/events            append raw RSSI events
    GET    /survey/progress          per-beacon counts vs target
    POST   /survey/finalize          save the active cell, end session
    POST   /survey/cancel            drop the active session

  Fingerprint store / matcher:
    GET    /fingerprint/cells        all surveyed cells + summary
    GET    /fingerprint/cells/<x>/<y>  one cell, or DELETE to remove
    POST   /fingerprint/clear        wipe the fingerprint
    GET    /fingerprint/summary      counts + floor RSSI
    POST   /fingerprint/match        one-shot match for an RSSI vector

  Live fingerprint pipeline (raw RSSI -> Gaussian match -> 4D KF):
    POST   /fp/start                 begin tracking, optionally seed R via LOO
    POST   /fp/rssi/events           stream raw RSSI events
    GET    /fp/position/latest       latest smoothed (x, y) + velocity
    POST   /fp/reset                 reset cached RSSI + KF state
    GET    /fp/status                diagnostic snapshot
    POST   /fp/params                live-tune sigma_a (Q) and/or R (2x2)
    GET    /fp/r/estimate            LOO cross-val without applying

  Misc:
    GET    /health                   simple health check
==========================================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from beacons import BeaconStore
from fingerprint import FingerprintStore
from fingerprint_match import match as fingerprint_match
from fingerprint_pipeline import FingerprintPipeline
from path_constraint import PathConstraint
from r_estimator import estimate_r_loo
from survey import SurveyCollector


app = Flask(__name__)
CORS(app)

# Persistent beacon registry — source of truth for which anchors exist.
beacon_store = BeaconStore()

# Fingerprint survey infrastructure — samples stored raw (no 1D KF)
# so the recorded variance reflects true sensor noise.
fingerprint_store = FingerprintStore()
survey_collector = SurveyCollector()

# Walkable-corridor polyline. Read by the live pipeline to clamp the
# smoothed (x, y) onto the path; exposed over /fp/path so the frontend
# can render it and let the user edit it.
path_constraint = PathConstraint()

# Fingerprint-based live tracking pipeline. Reads the same
# FingerprintStore the survey writes to. The beacon_store is wired in
# so the matcher only considers the user's registered anchors (and
# ignores any rogue id that leaked into the fingerprint).
fp_pipeline = FingerprintPipeline(
    store=fingerprint_store,
    beacon_store=beacon_store,
    path_constraint=path_constraint,
)


# ---------- Health ----------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "beacons": [b["name"] for b in beacon_store.list()],
        "fingerprint_cells": fingerprint_store.summary().get("cell_count", 0),
    })


# ---------- Beacons (persistent registry on disk) ----------

@app.route("/beacons", methods=["GET"])
def beacons_list():
    """Return all configured beacons as {beacon_id: {id, name, x, y, q?, r?}}."""
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
    KBeaconPro; when present, the live pipeline uses it as the primary
    match key so the beacon survives renames and iOS device.id drift.

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


# ---------- Fingerprint survey (grid-based site survey) ----------

def _survey_session_id(data=None):
    if data and data.get("session_id"):
        return str(data.get("session_id"))
    return str(request.args.get("session_id") or "default")


@app.route("/survey/start", methods=["POST"])
def survey_start():
    """Start collecting RSSI samples for ONE grid cell.

    Body: { "session_id": "phone-id", "x": 0.0, "y": 0.0, "samples_target": 50 }

    Replaces any in-progress session for that same session_id. Other phones'
    active sessions are unaffected. The frontend specifies samples_target per
    cell — there is no global default beyond the minimum of 1.
    """
    data = request.get_json(force=True) or {}
    session_id = _survey_session_id(data)
    try:
        x = float(data["x"])
        y = float(data["y"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "x and y are required numbers"}), 400
    try:
        samples_target = int(data.get("samples_target", 50))
    except (TypeError, ValueError):
        return jsonify({"error": "samples_target must be an integer"}), 400

    snap = survey_collector.start(x, y, samples_target, session_id=session_id)
    return jsonify({"status": "survey started", **snap})


def _canonicalize_events(events: list) -> list:
    """Translate event `beacon_id` to the canonical id from `BeaconStore`.

    BLE scanners report a `device.id` (MAC on Android, system UUID on
    iOS) which can drift in case or across phone/Bluetooth-cache resets,
    and an advertised name that the user can rewrite from KBeaconPro at
    any time. We resolve each event to the canonical configured
    `beacon_id` using the strongest identifier available, in priority
    order:

      1. iBeacon (uuid, major, minor) triple from the manufacturer data
         — STABLE across phones because it's burnt into the beacon by
         KBeaconPro. This is the preferred match.
      2. Case-insensitive name match against the registry's name field.
      3. Case-insensitive `beacon_id` match (legacy single-phone path
         where the device.id happened to land in the registry).

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


@app.route("/survey/events", methods=["POST"])
def survey_events():
    """Append raw RSSI events to the active survey cell's buffer.

    Body: { "events": [{"beacon_id": "...", "rssi": -67}, ...] }
        or { "beacon_id": "...", "rssi": -67 } for a single sample.

    Returns 409 if no survey is active.
    """
    data = request.get_json(force=True) or {}
    session_id = _survey_session_id(data)
    events = data.get("events")
    if events is None and "beacon_id" in data and "rssi" in data:
        events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
    if not isinstance(events, list):
        return jsonify({"error": "events list required"}), 400

    if not survey_collector.is_active(session_id):
        return jsonify({"error": "no active survey session — call /survey/start"}), 409

    canonical_events = _canonicalize_events(events)
    applied = survey_collector.ingest_events(canonical_events, session_id=session_id)
    snap = survey_collector.progress(session_id)
    return jsonify({"applied": applied, "received": len(events), **(snap or {})})


@app.route("/survey/progress", methods=["GET"])
def survey_progress():
    snap = survey_collector.progress(_survey_session_id())
    if snap is None:
        return jsonify({"active": False})
    return jsonify({"active": True, **snap})


@app.route("/survey/finalize", methods=["POST"])
def survey_finalize():
    """Save the active cell to the fingerprint store and end the session.

    Body (optional): { "expected_beacons": ["BCPro_0", ...] }
        Beacons listed here but missing from the buffer are stored as null
        (treated as "not detected at this position") so the cell always
        carries the full beacon dimension expected by downstream consumers.
    """
    data = request.get_json(silent=True) or {}
    session_id = _survey_session_id(data)
    expected = data.get("expected_beacons") or []

    buf = survey_collector.take_buffer(session_id)
    if buf is None:
        return jsonify({"error": "no active survey session"}), 409

    per_beacon = dict(buf["per_beacon_samples"])
    for bid in expected:
        if str(bid) not in per_beacon:
            per_beacon[str(bid)] = []

    cell = fingerprint_store.upsert_cell(buf["x"], buf["y"], per_beacon)
    fingerprint_store.save()
    return jsonify({
        "status": "cell saved",
        "cell": cell,
        "summary": fingerprint_store.summary(),
    })


@app.route("/survey/cancel", methods=["POST"])
def survey_cancel():
    data = request.get_json(silent=True) or {}
    was_active = survey_collector.cancel(_survey_session_id(data))
    return jsonify({"status": "cancelled" if was_active else "no active session"})


# ---------- Fingerprint store / matcher ----------

@app.route("/fingerprint/cells", methods=["GET"])
def fingerprint_cells():
    return jsonify({
        "cells": fingerprint_store.list_cells(),
        "summary": fingerprint_store.summary(),
    })


@app.route("/fingerprint/cells/<x>/<y>", methods=["GET", "DELETE"])
def fingerprint_cell_single(x, y):
    try:
        xf = float(x)
        yf = float(y)
    except (TypeError, ValueError):
        return jsonify({"error": "x and y must be numeric"}), 400

    if request.method == "DELETE":
        removed = fingerprint_store.delete_cell(xf, yf)
        if removed:
            fingerprint_store.save()
        return jsonify({"removed": removed})

    cell = fingerprint_store.get_cell(xf, yf)
    if cell is None:
        return jsonify({"error": "cell not found"}), 404
    return jsonify(cell)


@app.route("/fingerprint/clear", methods=["POST"])
def fingerprint_clear():
    fingerprint_store.clear()
    fingerprint_store.save()
    return jsonify({"status": "fingerprint cleared"})


@app.route("/fingerprint/summary", methods=["GET"])
def fingerprint_summary():
    return jsonify(fingerprint_store.summary())


@app.route("/fingerprint/match", methods=["POST"])
def fingerprint_match_route():
    """Estimate position from a current RSSI vector.

    Body: { "rssi": {"BCPro_0": -65, "BCPro_1": -73, ...}, "top_k": 4 }
        Beacon values may be null — they are floor-substituted at match
        time so the measurement vector dimension matches #beacons.
    """
    data = request.get_json(force=True) or {}
    rssi = data.get("rssi")
    if not isinstance(rssi, dict):
        return jsonify({"error": "rssi dict required"}), 400
    try:
        top_k = int(data.get("top_k", 4))
    except (TypeError, ValueError):
        return jsonify({"error": "top_k must be an integer"}), 400

    rssi_clean = {}
    for bid, v in rssi.items():
        if v is None:
            rssi_clean[str(bid)] = None
            continue
        try:
            rssi_clean[str(bid)] = float(v)
        except (TypeError, ValueError):
            continue

    result = fingerprint_match(fingerprint_store, rssi_clean, top_k=top_k)
    if result is None:
        return jsonify({
            "ready": False,
            "reason": "no surveyed cells overlap with the requested beacons",
        })
    return jsonify({"ready": True, **result})


# ---------- Fingerprint pipeline (raw RSSI -> match -> 4D KF) ----------

@app.route("/fp/start", methods=["POST"])
def fp_start():
    """Begin a live tracking session against the current fingerprint.

    Body (all optional):
        {
            "sigma_a": 0.5,        // process-noise std for 4D KF (m/s^2)
            "seed_r_from_loo": true // run LOO cross-val and apply R
        }

    Returns the LOO estimator output (R, RMSE, per-cell residuals) so the
    frontend can show a quality readout, or null if the survey is too
    sparse / no LOO seed was requested.
    """
    data = request.get_json(silent=True) or {}
    sigma_a = data.get("sigma_a")
    if sigma_a is not None:
        try:
            fp_pipeline.set_params(sigma_a=float(sigma_a))
        except (TypeError, ValueError):
            return jsonify({"error": "sigma_a must be numeric"}), 400

    fp_pipeline.reset()

    estimate = None
    if data.get("seed_r_from_loo", True):
        estimate = fp_pipeline.seed_r_from_loo()

    return jsonify({
        "status": "fp pipeline started",
        "r_estimate": estimate,
        "fingerprint_summary": fingerprint_store.summary(),
    })


@app.route("/fp/rssi/events", methods=["POST"])
def fp_rssi_events():
    """Stream raw RSSI events into the fingerprint pipeline's latest-value
    cache.

    Body: same shape as /survey/events. Events whose `beacon_name`
    matches a registered beacon get their `beacon_id` rewritten to the
    canonical registry id; without this normalization the live id from
    the BLE stack can drift from the id keying the fingerprint cells
    (e.g. iOS UUID case / per-phone identifier) and the matcher would
    silently floor-substitute every reading, freezing the position.

    Events whose `beacon_id` still does not match a registered beacon
    after canonicalisation are dropped, so unrelated BCPro advertisers
    in the same building cannot pollute the matcher with noise.
    """
    data = request.get_json(force=True) or {}
    events = data.get("events")
    if events is None and "beacon_id" in data and "rssi" in data:
        events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
    if not isinstance(events, list):
        return jsonify({"error": "events list required"}), 400
    canonical_events = _canonicalize_events(events)
    registered_ids = {str(entry.get("id")) for entry in beacon_store.list() if entry.get("id")}
    if registered_ids:
        filtered = [
            ev for ev in canonical_events
            if isinstance(ev, dict) and str(ev.get("beacon_id")) in registered_ids
        ]
        rejected_count = len(canonical_events) - len(filtered)
    else:
        filtered = canonical_events
        rejected_count = 0
    applied = fp_pipeline.ingest_events(filtered)
    return jsonify({
        "applied": applied,
        "received": len(events),
        "rejected_unregistered": rejected_count,
    })


@app.route("/fp/position/latest", methods=["GET"])
def fp_position_latest():
    """Match the latest RSSI vector against the fingerprint and run the
    4D KF. Returns ready=true with smoothed (x, y) + velocity, OR
    ready=false with a reason when no match is possible."""
    result = fp_pipeline.update_position()
    if result is None:
        active = fp_pipeline.get_status().get("active_beacons", [])
        return jsonify({
            "ready": False,
            "reason": (
                "no active beacons yet"
                if not active
                else "fingerprint is empty"
            ),
            "active_beacons": active,
        })
    if result.get("_no_overlap"):
        # We are seeing BLE packets, but the ids do not match any beacon
        # stored in the fingerprint. This typically means the BLE ids
        # drifted from the registry (case difference, iOS per-phone
        # UUID cache reset, surveyed on a different phone). The
        # /fp/rssi/events route already canonicalizes via beacon_name;
        # if that did not help, the frontend probably did not include
        # `beacon_name` or the beacon registry is missing entries.
        return jsonify({
            "ready": False,
            "reason": (
                "BLE ids do not match the fingerprint — "
                "active beacons are not in the surveyed set"
            ),
            "active_beacons": result["active_beacons"],
            "registered_beacons": result["registered_beacons"],
        })
    return jsonify({"ready": True, **result})


@app.route("/fp/reset", methods=["POST"])
def fp_reset():
    fp_pipeline.reset()
    return jsonify({"status": "fp pipeline reset"})


@app.route("/fp/status", methods=["GET"])
def fp_status():
    return jsonify(fp_pipeline.get_status())


@app.route("/fp/params", methods=["POST"])
def fp_params():
    """Manually set sigma_a and/or R.

    Body:
        {
            "sigma_a": 0.7,
            "R": [[0.25, 0.0], [0.0, 0.36]]   // 2x2 measurement noise
        }

    Either field is optional. Passing `R` switches r_source to "manual"
    and overrides any LOO-derived value.
    """
    data = request.get_json(force=True) or {}
    sigma_a = data.get("sigma_a")
    r = data.get("R")
    try:
        sa = float(sigma_a) if sigma_a is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "sigma_a must be numeric"}), 400

    if r is not None:
        try:
            r_np = [[float(r[0][0]), float(r[0][1])],
                    [float(r[1][0]), float(r[1][1])]]
        except (TypeError, ValueError, IndexError):
            return jsonify({"error": "R must be a 2x2 matrix"}), 400
    else:
        r_np = None

    fp_pipeline.set_params(sigma_a=sa, r=r_np)
    return jsonify({"status": "updated", **fp_pipeline.get_status()})


@app.route("/fp/path", methods=["GET"])
def fp_path_get():
    """Return the walkable polyline used by the live pipeline to clamp
    the smoothed position. Each segment is `{"x1","y1","x2","y2"}` in
    meters, same coordinate frame as the beacons."""
    return jsonify({"segments": path_constraint.segments()})


@app.route("/fp/path", methods=["POST"])
def fp_path_set():
    """Replace the polyline. Body: `{"segments": [...]}` — each segment
    accepted as `{"x1","y1","x2","y2"}`, `[x1,y1,x2,y2]`, or
    `[[x1,y1],[x2,y2]]`. Passing an empty list disables the constraint
    (positions are returned unprojected).
    """
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


@app.route("/fp/r/estimate", methods=["GET"])
def fp_r_estimate():
    """Run LOO cross-val WITHOUT applying the result to the live pipeline.
    Useful for inspecting expected accuracy before starting tracking."""
    estimate = estimate_r_loo(fingerprint_store)
    if estimate is None:
        return jsonify({
            "ready": False,
            "reason": "need at least 4 surveyed cells",
        })
    return jsonify({"ready": True, **estimate})


# ---------- Run ----------

if __name__ == "__main__":
    fp_summary = fingerprint_store.summary()
    print("=" * 60)
    print("  BLE Indoor Localization Backend")
    print(f"  Beacons:           {len(beacon_store.list())} configured")
    print(f"  Fingerprint cells: {fp_summary.get('cell_count', 0)}")
    floor = fp_summary.get("floor_rssi")
    print(f"  Floor RSSI:        {floor:.2f} dBm" if floor is not None else "  Floor RSSI:        — (no survey yet)")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True)
