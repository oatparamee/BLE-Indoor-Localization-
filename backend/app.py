"""
==========================================================================
  BLE Indoor Localization — Flask Backend
==========================================================================
  Calibration:
    POST /calibrate/sample        submit one RSSI + known distance sample
    GET  /calibrate/analyze       noise stats + suggested Q, R
    POST /calibrate/reset         clear samples

  Legacy single-shot trilateration (still supported, no per-beacon KF):
    POST /position                trilaterate + global position KF from
                                  one batch of {beacons:[{id,name,x,y,rssi}]}
    POST /kalman/initialize       set Q/R on the legacy global KF
    POST /kalman/update           live-tune Q and/or R on the legacy KF
    GET  /kalman/status           legacy KF state
    POST /kalman/reset            reset the legacy KF

  New two-stage pipeline (per-beacon RSSI KF -> trilateration -> position KF):
    POST /pipeline/setup          register beacon coordinates for a session
    POST /rssi/events             ingest a batch of {beacon_id, rssi} events
    GET  /position/latest         compute + return current smoothed position
    POST /pipeline/reset          clear all per-beacon filters + position KF
    GET  /pipeline/status         diagnostic snapshot
    POST /pipeline/kalman/update  live-tune Q/R on the pipeline's position KF

  Misc:
    GET  /health                  simple health check
==========================================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from config import BEACONS, RSSI_D0, N
from calibration import CalibrationStore
from kalman_filter import AdaptiveKalmanFilter
from positioning_pipeline import PositioningPipeline
from trilateration import trilaterate, trilaterate_with_positions

# Hysteresis: only swap a beacon out of the active set if the challenger
# is at least this many dB stronger than the weakest currently active beacon.
last_active_ids: list[str] = []
HYSTERESIS_THRESHOLD = 10.0


def _select_top3_with_hysteresis(all_beacons: list, last_ids: list[str]) -> list:
    """Return 3 beacons using hysteresis to prevent rapid beacon flipping."""
    beacon_map = {b["id"]: b for b in all_beacons}

    # Restore previously active beacons that are still visible.
    active = [beacon_map[bid] for bid in last_ids if bid in beacon_map]

    if len(active) < 3:
        # No stable history yet — fall back to strongest 3 by RSSI.
        return sorted(all_beacons, key=lambda b: b["rssi"], reverse=True)[:3]

    active_ids = {b["id"] for b in active}
    challengers = sorted(
        [b for b in all_beacons if b["id"] not in active_ids],
        key=lambda b: b["rssi"],
        reverse=True,
    )

    result = list(active)
    for challenger in challengers:
        weakest = min(result, key=lambda b: b["rssi"])
        if challenger["rssi"] > weakest["rssi"] + HYSTERESIS_THRESHOLD:
            result.remove(weakest)
            result.append(challenger)
        else:
            break  # Remaining challengers are even weaker — stop early.

    return result

app = Flask(__name__)
CORS(app)

calibration = CalibrationStore(max_samples=30)

# Legacy single-shot KF — still wired to /position and /kalman/* endpoints.
kalman = AdaptiveKalmanFilter(q_value=0.01, r_value=1.0)

# New two-stage pipeline — owned by /pipeline/* and /rssi/events and
# /position/latest. Beacons are registered at runtime via /pipeline/setup,
# so we start with an empty registry.
pipeline = PositioningPipeline(
    beacon_positions={},
    q_rssi=4.0565,
    r_rssi=1.9188,
    q_position=0.01,
    r_position=1.0,
    beacon_timeout_s=5.0,
)


# ---------- Health ----------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "beacons": list(BEACONS.keys())})


# ---------- Calibration ----------

@app.route("/calibrate/sample", methods=["POST"])
def calibrate_sample():
    data = request.get_json(force=True)
    rssi = data.get("rssi")
    distance = data.get("distance")
    if rssi is None or distance is None:
        return jsonify({"error": "rssi and distance are required"}), 400

    result = calibration.add_sample(float(rssi), float(distance))
    return jsonify(result)


@app.route("/calibrate/analyze", methods=["GET"])
def calibrate_analyze():
    result = calibration.analyze()
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/calibrate/reset", methods=["POST"])
def calibrate_reset():
    data = request.get_json(silent=True) or {}
    max_samples = data.get("max_samples")
    calibration.clear()
    if max_samples is not None:
        try:
            calibration.set_max_samples(int(max_samples))
        except (TypeError, ValueError):
            return jsonify({"error": "max_samples must be a positive integer"}), 400
    return jsonify({
        "status": "calibration samples cleared",
        "max_samples": calibration.max_samples,
    })


# ---------- Kalman Filter ----------

@app.route("/kalman/initialize", methods=["POST"])
def kalman_initialize():
    data = request.get_json(force=True)
    q = data.get("Q")
    r = data.get("R")
    if q is None or r is None:
        return jsonify({"error": "Q and R are required"}), 400

    kalman.initialize_from_calibration(float(q), float(r))
    return jsonify({
        "status": "Kalman filter initialized",
        "Q": float(q),
        "R": float(r),
    })


@app.route("/kalman/update", methods=["POST"])
def kalman_update_params():
    data = request.get_json(force=True)
    q = data.get("Q")
    r = data.get("R")
    if q is not None:
        kalman.set_q(float(q))
    if r is not None:
        kalman.set_r(float(r))
    return jsonify({
        "status": "updated",
        "Q": kalman.q_base,
        "R": float(kalman.R[0, 0]),
    })


@app.route("/kalman/status", methods=["GET"])
def kalman_status():
    return jsonify(kalman.get_status())


@app.route("/kalman/reset", methods=["POST"])
def kalman_reset():
    kalman.reset()
    return jsonify({"status": "Kalman filter reset"})


# ---------- Position ----------

@app.route("/position", methods=["POST"])
def position():
    global last_active_ids
    data = request.get_json(force=True)
    all_detected = data.get("beacons", [])

    if len(all_detected) < 3:
        return jsonify({"error": "Need at least 3 beacons"}), 400

    top_3 = _select_top3_with_hysteresis(all_detected, last_active_ids)
    last_active_ids = [b["id"] for b in top_3]

    try:
        distances_dict, raw_x, raw_y = trilaterate_with_positions(top_3)
        smooth_x, smooth_y = kalman.step([raw_x, raw_y])

        return jsonify({
            "distances": distances_dict,
            "raw_position": {"x": round(raw_x, 4), "y": round(raw_y, 4)},
            "smooth_position": {"x": round(smooth_x, 4), "y": round(smooth_y, 4)},
            "converged": kalman.converged,
            "active_beacons": last_active_ids,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ---------- Pipeline (two-stage Kalman: per-beacon RSSI KF + position KF) ----------

@app.route("/pipeline/setup", methods=["POST"])
def pipeline_setup():
    """
    Register beacon coordinates for a tracking session. Body shape:

        {
            "beacons": [
                {"id": "AA:BB:...", "name": "Beacon_A", "x": 0.0, "y": 0.0},
                ...
            ],
            "reset_position_filter": true
        }

    Replaces any previously registered beacons. Per-beacon RSSI filters
    are cleared. By default the position Kalman filter is also reset so
    a fresh session starts cold.
    """
    data = request.get_json(force=True)
    beacons = data.get("beacons", [])
    if not isinstance(beacons, list) or len(beacons) < 1:
        return jsonify({"error": "beacons must be a non-empty list"}), 400

    try:
        pipeline.replace_beacons(beacons)
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": f"invalid beacon entry: {e}"}), 400

    if data.get("reset_position_filter", True):
        pipeline.reset_position_filter()

    status = pipeline.get_status()
    return jsonify({
        "status": "pipeline ready",
        "registered_beacons": status["registered_beacons"],
    })


@app.route("/rssi/events", methods=["POST"])
def rssi_events():
    """
    Ingest a batch of raw RSSI events into the per-beacon Kalman filters.
    Body shape:

        {
            "events": [
                {"beacon_id": "AA:BB:...", "rssi": -67},
                {"beacon_id": "CC:DD:...", "rssi": -71},
                ...
            ]
        }

    Unknown beacons (not registered via /pipeline/setup) are silently
    dropped. Returns the number of events that were applied.
    """
    data = request.get_json(force=True)
    events = data.get("events")
    if events is None:
        # Allow a single event for convenience.
        if "beacon_id" in data and "rssi" in data:
            events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
        else:
            return jsonify({"error": "events list (or beacon_id+rssi) required"}), 400

    if not isinstance(events, list):
        return jsonify({"error": "events must be a list"}), 400

    applied = pipeline.ingest_events(events)
    return jsonify({"applied": applied, "received": len(events)})


@app.route("/position/latest", methods=["GET"])
def position_latest():
    """
    Run the periodic stage of the pipeline: trilaterate from the latest
    filtered RSSI per beacon and smooth the result through the position
    Kalman filter.

    Returns 200 in BOTH cases:
      - ready=true with raw_position, smooth_position, distances, etc.
      - ready=false when fewer than 3 active beacons or trilateration
        failed (with a `reason` field).
    """
    result = pipeline.update_position()
    if result is None:
        active = pipeline.get_active_beacons()
        return jsonify({
            "ready": False,
            "reason": (
                f"need >= 3 active beacons, have {len(active)}"
                if len(active) < 3
                else "trilateration failed (geometry / collinearity)"
            ),
            "active_beacons": active,
        })

    return jsonify({"ready": True, **result})


@app.route("/pipeline/reset", methods=["POST"])
def pipeline_reset():
    """Clear per-beacon filters and reset the position Kalman filter."""
    pipeline.reset_all()
    return jsonify({"status": "pipeline reset"})


@app.route("/pipeline/status", methods=["GET"])
def pipeline_status():
    """Diagnostic snapshot of the pipeline."""
    return jsonify(pipeline.get_status())


@app.route("/pipeline/kalman/update", methods=["POST"])
def pipeline_kalman_update():
    """Live-tune Q and/or R on the pipeline's position Kalman filter."""
    data = request.get_json(force=True)
    q = data.get("Q")
    r = data.get("R")
    if q is None and r is None:
        return jsonify({"error": "Q and/or R required"}), 400
    pipeline.set_position_kalman_params(
        q=float(q) if q is not None else None,
        r=float(r) if r is not None else None,
    )
    status = pipeline.get_status()
    return jsonify({
        "status": "updated",
        "Q": status["position_q"],
        "R": status["position_r_current"],
    })


# ---------- Run ----------

if __name__ == "__main__":
    print("=" * 60)
    print("  BLE Indoor Localization Backend")
    print(f"  Beacons: {list(BEACONS.keys())}")
    print(f"  RSSI_D0 (ref at 1m): {RSSI_D0}")
    print(f"  N (path loss exponent): {N}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True)
