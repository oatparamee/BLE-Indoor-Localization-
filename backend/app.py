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
from trilateration import trilaterate

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
    calibration.clear()
    return jsonify({"status": "calibration samples cleared"})


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
    data = request.get_json(force=True)

    if not data or not isinstance(data, dict):
        return jsonify({"error": "Send RSSI dict like {\"Beacon_A\": -65, ...}"}), 400

    known = {k: v for k, v in data.items() if k in BEACONS}
    if len(known) < 3:
        return jsonify({
            "error": f"Need at least 3 known beacons, got {len(known)}",
            "received": list(data.keys()),
            "known": list(known.keys()),
        }), 400

    try:
        distances_dict, raw_x, raw_y = trilaterate(known)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    smooth_x, smooth_y = kalman.step([raw_x, raw_y])

    return jsonify({
        "distances": distances_dict,
        "raw_position": {"x": round(raw_x, 4), "y": round(raw_y, 4)},
        "smooth_position": {"x": round(smooth_x, 4), "y": round(smooth_y, 4)},
        "converged": kalman.converged,
    })


# ---------- Run ----------

if __name__ == "__main__":
    print("=" * 60)
    print("  BLE Indoor Localization Backend")
    print(f"  Beacons: {list(BEACONS.keys())}")
    print(f"  RSSI_D0 (ref at 1m): {RSSI_D0}")
    print(f"  N (path loss exponent): {N}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)
