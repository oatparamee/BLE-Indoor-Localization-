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

  New two-stage pipeline (per-beacon RSSI KF -> weighted trilateration ->
  rolling median over (x,y)):
    POST /pipeline/setup            register beacon coordinates (and optional
                                    per-beacon RSSI Kalman q/r) for a session
    POST /rssi/events               ingest a batch of {beacon_id, rssi} events
    GET  /position/latest           compute + return current smoothed position
    POST /pipeline/reset            clear all per-beacon filters + median window
    GET  /pipeline/status           diagnostic snapshot
    POST /pipeline/beacon/kalman    live-tune one beacon's 1D Kalman q/r
    POST /pipeline/kalman/update    deprecated no-op (median filter has no Q/R)

  Misc:
    GET  /health                  simple health check
==========================================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

from config import BEACONS, RSSI_D0, N
from calibration import CalibrationStore
from debug_log import debug_log
from fingerprint import FingerprintStore
from fingerprint_match import match as fingerprint_match
from fingerprint_pipeline import FingerprintPipeline
from kalman_filter import AdaptiveKalmanFilter
from positioning_pipeline import PositioningPipeline
from r_estimator import estimate_r_loo
from survey import SurveyCollector
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

# Fingerprint survey infrastructure — independent of the live pipeline.
# Survey samples are stored raw (no 1D KF) so the recorded variance
# reflects true sensor noise. See backend/fingerprint.py and survey.py.
fingerprint_store = FingerprintStore()
survey_collector = SurveyCollector()

# Fingerprint-based live tracking pipeline. Owned by /fp/* routes; reads
# the same FingerprintStore the survey writes to. R is seeded from
# leave-one-out cross-val the first time /fp/start is called.
fp_pipeline = FingerprintPipeline(store=fingerprint_store)


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
                {
                    "id": "AA:BB:...",
                    "name": "Beacon_A",
                    "x": 0.0,
                    "y": 0.0,
                    "q": 0.7143,   # optional — per-beacon 1D KF process noise
                    "r": 1.29      # optional — per-beacon 1D KF measurement noise
                },
                ...
            ],
            "reset_position_filter": true
        }

    Replaces any previously registered beacons. Per-beacon RSSI filters
    are cleared. By default the position median filter is also reset so
    a fresh session starts cold. Beacons with no q/r fall back to the
    pipeline's global default (q_rssi / r_rssi).
    """
    data = request.get_json(force=True)
    beacons = data.get("beacons", [])
    if not isinstance(beacons, list) or len(beacons) < 1:
        return jsonify({"error": "beacons must be a non-empty list"}), 400

    try:
        pipeline.replace_beacons(beacons)
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": f"invalid beacon entry: {e}"}), 400

    # region agent log
    debug_log(
        "backend/app.py:244",
        "pipeline setup registered beacons",
        {
            "beaconCount": len(beacons),
            "beacons": [
                {
                    "id": str(b.get("id") or b.get("name") or ""),
                    "name": str(b.get("name") or b.get("id") or ""),
                    "x": b.get("x"),
                    "y": b.get("y"),
                }
                for b in beacons[:6]
            ],
        },
        hypothesis_id="H1",
    )
    # endregion

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
    # region agent log
    debug_log(
        "backend/app.py:287",
        "rssi batch ingested",
        {
            "received": len(events),
            "applied": applied,
            "sample": events[:5],
        },
        hypothesis_id="H2",
    )
    # endregion
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
        # region agent log
        debug_log(
            "backend/app.py:307",
            "position latest not ready",
            {
                "activeBeaconCount": len(active),
                "activeBeacons": active,
            },
            hypothesis_id="H2",
        )
        # endregion
        return jsonify({
            "ready": False,
            "reason": (
                f"need >= 3 active beacons, have {len(active)}"
                if len(active) < 3
                else "trilateration failed (geometry / collinearity)"
            ),
            "active_beacons": active,
        })

    # region agent log
    debug_log(
        "backend/app.py:320",
        "position latest ready",
        {
            "activeBeacons": result.get("active_beacons", []),
            "rawPosition": result.get("raw_position"),
            "smoothPosition": result.get("smooth_position"),
            "converged": result.get("converged"),
        },
        hypothesis_id="H4",
    )
    # endregion
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


@app.route("/pipeline/beacon/kalman", methods=["POST"])
def pipeline_beacon_kalman():
    """Live-tune a single beacon's 1D Kalman q/r without re-setup.

    Body shape:
        { "beacon_id": "AA:BB:...", "q": 0.71, "r": 1.29 }

    Passing q and r both null clears the override and the beacon falls
    back to the pipeline's global default. Returns 404 if the beacon
    is not currently registered.
    """
    data = request.get_json(force=True) or {}
    beacon_id = data.get("beacon_id") or data.get("id")
    if not beacon_id:
        return jsonify({"error": "beacon_id is required"}), 400
    q = data.get("q")
    r = data.get("r")
    try:
        q_val = float(q) if q is not None else None
        r_val = float(r) if r is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "q and r must be numeric or null"}), 400

    ok = pipeline.set_beacon_kalman_params(str(beacon_id), q=q_val, r=r_val)
    if not ok:
        return jsonify({
            "error": f"beacon '{beacon_id}' is not registered; call /pipeline/setup first",
        }), 404
    return jsonify({
        "status": "updated",
        "beacon_id": str(beacon_id),
        "params": pipeline.get_beacon_kalman_params(str(beacon_id)),
    })


@app.route("/pipeline/kalman/update", methods=["POST"])
def pipeline_kalman_update():
    """Deprecated.

    Stage 2 of the pipeline is now a rolling median filter (see
    POSITION_MEDIAN_WINDOW in config.py); there is no longer a Q/R to
    tune. The endpoint is kept so older clients don't 500 — it accepts
    the request, ignores Q/R, and returns the current median window
    size for diagnostic purposes.
    """
    data = request.get_json(force=True) or {}
    q = data.get("Q")
    r = data.get("R")
    pipeline.set_position_kalman_params(
        q=float(q) if q is not None else None,
        r=float(r) if r is not None else None,
    )
    status = pipeline.get_status()
    return jsonify({
        "status": "ignored — stage 2 is a median filter, no Q/R to tune",
        "position_median_window": status.get("position_median_window"),
        "position_window_fill": status.get("position_window_fill"),
    })


# ---------- Fingerprint survey (grid-based site survey) ----------

@app.route("/survey/start", methods=["POST"])
def survey_start():
    """Start collecting RSSI samples for ONE grid cell.

    Body: { "x": 0.0, "y": 0.0, "samples_target": 50 }

    Replaces any in-progress session. The frontend specifies samples_target
    per cell — there is no global default beyond the minimum of 1.
    """
    data = request.get_json(force=True) or {}
    try:
        x = float(data["x"])
        y = float(data["y"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "x and y are required numbers"}), 400
    try:
        samples_target = int(data.get("samples_target", 50))
    except (TypeError, ValueError):
        return jsonify({"error": "samples_target must be an integer"}), 400

    snap = survey_collector.start(x, y, samples_target)
    return jsonify({"status": "survey started", **snap})


@app.route("/survey/events", methods=["POST"])
def survey_events():
    """Append raw RSSI events to the active survey cell's buffer.

    Body: { "events": [{"beacon_id": "...", "rssi": -67}, ...] }
        or { "beacon_id": "...", "rssi": -67 } for a single sample.

    Returns 409 if no survey is active.
    """
    data = request.get_json(force=True) or {}
    events = data.get("events")
    if events is None and "beacon_id" in data and "rssi" in data:
        events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
    if not isinstance(events, list):
        return jsonify({"error": "events list required"}), 400

    if not survey_collector.is_active():
        return jsonify({"error": "no active survey session — call /survey/start"}), 409

    applied = survey_collector.ingest_events(events)
    snap = survey_collector.progress()
    return jsonify({"applied": applied, "received": len(events), **(snap or {})})


@app.route("/survey/progress", methods=["GET"])
def survey_progress():
    snap = survey_collector.progress()
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
    expected = data.get("expected_beacons") or []

    buf = survey_collector.take_buffer()
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
    was_active = survey_collector.cancel()
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
    cache. Same payload shape as /rssi/events."""
    data = request.get_json(force=True) or {}
    events = data.get("events")
    if events is None and "beacon_id" in data and "rssi" in data:
        events = [{"beacon_id": data["beacon_id"], "rssi": data["rssi"]}]
    if not isinstance(events, list):
        return jsonify({"error": "events list required"}), 400
    applied = fp_pipeline.ingest_events(events)
    return jsonify({"applied": applied, "received": len(events)})


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
                else "fingerprint is empty or no overlap with active beacons"
            ),
            "active_beacons": active,
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
    print("=" * 60)
    print("  BLE Indoor Localization Backend")
    print(f"  Beacons: {list(BEACONS.keys())}")
    print(f"  RSSI_D0 (ref at 1m): {RSSI_D0}")
    print(f"  N (path loss exponent): {N}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=True)
