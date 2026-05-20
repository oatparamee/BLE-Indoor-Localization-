"""
Trilateration-based live tracking pipeline.

    raw RSSI stream
        │
        ▼
    per-beacon rolling-mean RSSI   (smoothing — distance is exponential
                                    in RSSI, so a single noisy sample is
                                    very damaging to trilateration)
        │
        ▼  (periodic — e.g. every 0.5 s)
    rssi_to_distance() per beacon  →  trilaterate()  →  raw (x, y)
        │
        ▼
    PositionKalmanFilter4D         →  smoothed (x, y) + velocity
        │
        ▼
    PathConstraint.project()       →  clamp onto the walkable corridor

Beacon coordinates come from the BeaconStore — there is NO site survey,
so the same app works at any location once the beacons are placed and
their (x, y) entered in the Setup tab.
"""

import threading
import time
from collections import deque
from typing import Optional

from position_kf import PositionKalmanFilter4D
from trilateration import rssi_to_distance, trilaterate


DEFAULT_SIGMA_A = 0.5
DEFAULT_SMOOTHING_WINDOW = 10

# Default measurement noise (m²). Trilateration indoors is typically
# good to a few metres; std ≈ 2 m → variance 4. Tunable at runtime via
# set_params() / the /fp/params route.
DEFAULT_R_VARIANCE = 4.0


class TrackingPipeline:
    def __init__(
        self,
        beacon_store,
        path_constraint=None,
        sigma_a: float = DEFAULT_SIGMA_A,
        beacon_timeout_s: float = 5.0,
        smoothing_window: int = DEFAULT_SMOOTHING_WINDOW,
    ):
        self.beacon_store = beacon_store
        self.path_constraint = path_constraint
        self.kf = PositionKalmanFilter4D(sigma_a=sigma_a)
        self.kf.set_r([[DEFAULT_R_VARIANCE, 0.0], [0.0, DEFAULT_R_VARIANCE]])
        self.beacon_timeout_s = float(beacon_timeout_s)
        self.smoothing_window = max(1, int(smoothing_window))

        self._lock = threading.Lock()
        self._latest_rssi: dict = {}   # beacon_id → latest raw RSSI (display)
        self._rssi_window: dict = {}   # beacon_id → deque of recent raw RSSI
        self._last_seen: dict = {}     # beacon_id → time.time()
        self._last_result: Optional[dict] = None

    # ── Configuration ─────────────────────────────────────────────

    def set_params(
        self,
        sigma_a: Optional[float] = None,
        r=None,
        smoothing_window: Optional[int] = None,
    ) -> None:
        with self._lock:
            if sigma_a is not None:
                self.kf.set_sigma_a(float(sigma_a))
            if r is not None:
                self.kf.set_r(r)
            if smoothing_window is not None:
                w = max(1, int(smoothing_window))
                self.smoothing_window = w
                self._rssi_window = {
                    bid: deque(list(win)[-w:], maxlen=w)
                    for bid, win in self._rssi_window.items()
                }

    def reset(self) -> None:
        with self._lock:
            self._latest_rssi.clear()
            self._rssi_window.clear()
            self._last_seen.clear()
            self.kf.reset()
            self._last_result = None

    # ── Ingest ────────────────────────────────────────────────────

    def ingest_events(self, events: list) -> int:
        if not events:
            return 0
        now = time.time()
        applied = 0
        with self._lock:
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                bid = ev.get("beacon_id") or ev.get("id")
                rssi = ev.get("rssi")
                if bid is None or rssi is None:
                    continue
                try:
                    bid = str(bid)
                    rssi_f = float(rssi)
                except (TypeError, ValueError):
                    continue
                self._latest_rssi[bid] = rssi_f
                win = self._rssi_window.get(bid)
                if win is None:
                    win = deque(maxlen=self.smoothing_window)
                    self._rssi_window[bid] = win
                win.append(rssi_f)
                self._last_seen[bid] = now
                applied += 1
        return applied

    # ── Compute position ──────────────────────────────────────────

    def update_position(self) -> Optional[dict]:
        with self._lock:
            self._prune_stale_locked()
            if not self._rssi_window:
                return None

            registry = {
                e["id"]: e
                for e in self.beacon_store.list()
                if e.get("id")
            }

            # Build (x, y, distance) anchors from each beacon's rolling
            # mean RSSI. Beacons not in the registry (no known position)
            # are skipped — they can't anchor anything.
            anchors = []
            for bid, win in self._rssi_window.items():
                if not win:
                    continue
                beacon = registry.get(bid)
                if beacon is None:
                    continue
                mean_rssi = sum(win) / len(win)
                dist = rssi_to_distance(mean_rssi)
                anchors.append((beacon["x"], beacon["y"], dist))

            if len(anchors) < 3:
                return {
                    "_insufficient": True,
                    "active_beacons": sorted(self._latest_rssi.keys()),
                    "anchor_count": len(anchors),
                }

            raw = trilaterate(anchors)
            if raw is None:
                # 3+ anchors but geometrically degenerate (collinear).
                return {
                    "_insufficient": True,
                    "active_beacons": sorted(self._latest_rssi.keys()),
                    "anchor_count": len(anchors),
                    "degenerate": True,
                }

            now = time.time()
            kf_state = self.kf.update(raw[0], raw[1], now)
            sx, sy = kf_state["x"], kf_state["y"]

            # Clamp the smoothed output onto the walkable corridor.
            constrained = None
            if (
                self.path_constraint is not None
                and not self.path_constraint.is_empty()
            ):
                px, py = self.path_constraint.project(sx, sy)
                constrained = {"x": round(px, 4), "y": round(py, 4)}

            out = {
                "raw_position": {"x": round(raw[0], 4), "y": round(raw[1], 4)},
                "kf_position": {"x": round(sx, 4), "y": round(sy, 4)},
                "smooth_position": constrained or {
                    "x": round(sx, 4),
                    "y": round(sy, 4),
                },
                "constrained_to_path": constrained is not None,
                "velocity": {
                    "vx": round(kf_state["vx"], 4),
                    "vy": round(kf_state["vy"], 4),
                },
                "active_beacons": sorted(self._latest_rssi.keys()),
                "anchor_count": len(anchors),
                "timestamp": now,
                "initialized": self.kf.initialized,
            }
            self._last_result = out
            return out

    # ── Inspection ────────────────────────────────────────────────

    def get_status(self) -> dict:
        with self._lock:
            self._prune_stale_locked()
            return {
                "registered_beacons": [
                    e["id"] for e in self.beacon_store.list() if e.get("id")
                ],
                "active_beacons": sorted(self._latest_rssi.keys()),
                "latest_rssi": dict(self._latest_rssi),
                "sigma_a": self.kf.sigma_a,
                "R": self.kf.R.tolist(),
                "smoothing_window": self.smoothing_window,
                "last_result": self._last_result,
                "beacon_timeout_s": self.beacon_timeout_s,
                "initialized": self.kf.initialized,
                "has_path_constraint": self.path_constraint is not None,
            }

    # ── Internals ──────────────────────────────────────────────────

    def _prune_stale_locked(self) -> None:
        cutoff = time.time() - self.beacon_timeout_s
        stale = [bid for bid, t in self._last_seen.items() if t < cutoff]
        for bid in stale:
            self._latest_rssi.pop(bid, None)
            self._rssi_window.pop(bid, None)
            self._last_seen.pop(bid, None)
