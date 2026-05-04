"""
==========================================================================
  BLE Indoor Localization — Flask Backend
==========================================================================
  Endpoints:
    POST /calibrate/sample   — submit one RSSI + known distance sample
    GET  /calibrate/analyze   — get noise stats and suggested Q, R
    POST /kalman/initialize   — init Kalman with Q and R from calibration
    POST /kalman/update       — update Q and/or R in real time
    GET  /kalman/status       — current filter state, Q, R, convergence
    POST /kalman/reset        — reset the Kalman filter
    POST /position            — trilaterate + Kalman smooth from RSSI dict
    GET  /health              — simple health check
==========================================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from config import BEACONS, RSSI_D0, N
from calibration import CalibrationStore
from kalman_filter import AdaptiveKalmanFilter
from trilateration import trilaterate, trilaterate_with_positions

# Hysteresis: only swap a beacon out of the active set if the challenger
# is at least this many dB stronger than the weakest currently active beacon.
last_active_ids: list[str] = []
HYSTERESIS_THRESHOLD = 3.0


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
kalman = AdaptiveKalmanFilter(q_value=0.01, r_value=1.0)


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


# ---------- Run ----------

if __name__ == "__main__":
    print("=" * 60)
    print("  BLE Indoor Localization Backend")
    print(f"  Beacons: {list(BEACONS.keys())}")
    print(f"  RSSI_D0 (ref at 1m): {RSSI_D0}")
    print(f"  N (path loss exponent): {N}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True)
