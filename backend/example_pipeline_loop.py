"""
Runnable demo of the two-stage Kalman pipeline.

Simulates the real-time pattern:
  - RSSI events arrive at high frequency from a producer thread
    (in production this is the BLE callback firing per advertisement).
  - A consumer thread calls update_position() every 0.5 seconds and
    prints the smoothed (x, y).

Run from the backend folder:
    python example_pipeline_loop.py

Press Ctrl-C to stop.
"""

import math
import random
import threading
import time

from positioning_pipeline import PositioningPipeline


# ── Synthetic environment ─────────────────────────────────────────

# Three anchors arranged in a triangle (matches backend/config.py shape).
BEACONS = {
    "BCPro_0": {"name": "Beacon_A", "x": 0.0, "y": 0.0},
    "BCPro_1": {"name": "Beacon_B", "x": 6.0, "y": 0.0},
    "BCPro_2": {"name": "Beacon_C", "x": 3.0, "y": 5.0},
}

# Path-loss model used to fake RSSI from a known true position.
RSSI_D0 = -63
N = 1.3
NOISE_STD = 4.0   # dB — typical raw RSSI noise


def true_rssi_for(beacon, true_x, true_y):
    """RSSI a beacon would emit (before noise) for a phone at (true_x, true_y)."""
    dx = beacon["x"] - true_x
    dy = beacon["y"] - true_y
    d = max(0.1, math.hypot(dx, dy))
    return RSSI_D0 - 10.0 * N * math.log10(d)


def noisy_rssi_for(beacon, true_x, true_y):
    """Noisy advertisement-level RSSI — what the BLE radio actually reports."""
    return true_rssi_for(beacon, true_x, true_y) + random.gauss(0.0, NOISE_STD)


# ── Pipeline setup ────────────────────────────────────────────────

pipeline = PositioningPipeline(
    beacon_positions=BEACONS,
    q_rssi=4.0565,
    r_rssi=1.9188,
    q_position=0.01,
    r_position=1.0,
    beacon_timeout_s=5.0,
)


# ── Producer: high-frequency RSSI events ──────────────────────────

stop_event = threading.Event()

# Walk the phone around so smoothing is visible.
true_position_lock = threading.Lock()
true_position = {"x": 2.5, "y": 2.0}


def rssi_producer():
    """Simulates ~30 BLE advertisements per second across all beacons."""
    while not stop_event.is_set():
        with true_position_lock:
            tx, ty = true_position["x"], true_position["y"]

        beacon_id = random.choice(list(BEACONS.keys()))
        rssi = noisy_rssi_for(BEACONS[beacon_id], tx, ty)
        pipeline.on_rssi_received(beacon_id, rssi)

        time.sleep(1.0 / 30.0)   # ~30 Hz total event rate


def true_position_walker():
    """Slowly drift the 'true' position so we can see the filter track it."""
    t0 = time.time()
    while not stop_event.is_set():
        t = time.time() - t0
        with true_position_lock:
            true_position["x"] = 3.0 + 1.5 * math.sin(t * 0.3)
            true_position["y"] = 2.5 + 1.5 * math.cos(t * 0.3)
        time.sleep(0.05)


# ── Consumer: periodic position update at 2 Hz ────────────────────

def position_consumer():
    while not stop_event.is_set():
        result = pipeline.update_position()
        with true_position_lock:
            tx, ty = true_position["x"], true_position["y"]

        if result is None:
            print("[position] waiting for >= 3 active beacons...")
        else:
            sm = result["smooth_position"]
            raw = result["raw_position"]
            err = math.hypot(sm["x"] - tx, sm["y"] - ty)
            print(
                f"[position] true=({tx:5.2f},{ty:5.2f}) "
                f"raw=({raw['x']:5.2f},{raw['y']:5.2f}) "
                f"smooth=({sm['x']:5.2f},{sm['y']:5.2f}) "
                f"|err|={err:.2f} m  "
                f"converged={result['converged']}"
            )

        time.sleep(0.5)


# ── Main ──────────────────────────────────────────────────────────

def main():
    threads = [
        threading.Thread(target=rssi_producer, daemon=True),
        threading.Thread(target=true_position_walker, daemon=True),
        threading.Thread(target=position_consumer, daemon=True),
    ]
    for t in threads:
        t.start()

    print("Pipeline demo running. Press Ctrl-C to stop.\n")
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping...")
        stop_event.set()
        for t in threads:
            t.join(timeout=1.0)


if __name__ == "__main__":
    main()
