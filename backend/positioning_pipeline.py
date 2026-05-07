"""
Two-stage Kalman filter pipeline for BLE indoor localization.

Stage 1 — per-beacon RSSI smoothing:
    One RssiKalmanFilter per beacon_id. Absorbs the high-frequency
    noisy RSSI stream coming straight off the BLE radio.

Stage 2 — position smoothing:
    AdaptiveKalmanFilter on the trilaterated (x, y). Same instance the
    backend has been using; R adapts from observed innovation variance.

Pipeline:

    BLE scan emits raw RSSI events (~10-30 Hz across all beacons)
            │
            ▼
    pipeline.on_rssi_received(beacon_id, rssi)
        → updates that beacon's RssiKalmanFilter
        → caches the latest filtered RSSI + timestamp
            │
            ▼   (called periodically — e.g. every 0.5 s)
    pipeline.update_position()
        → drops beacons not seen for `beacon_timeout_s`
        → builds beacons_list from cached filtered RSSI
        → calls trilaterate_with_positions()
        → feeds raw (x, y) into AdaptiveKalmanFilter
        → returns smoothed position (or None when < 3 active beacons)
"""

import time
import threading
from typing import Optional

from kalman_filter import AdaptiveKalmanFilter
from rssi_kalman import RssiKalmanFilter
from trilateration import trilaterate_with_positions


class PositioningPipeline:
    """
    End-to-end pipeline: raw RSSI → per-beacon Kalman → distance →
    trilateration → position Kalman → smoothed (x, y).

    Thread-safe: a single internal lock guards all mutable state so
    on_rssi_received() can be called from a BLE callback thread while
    update_position() runs from a periodic scheduler thread.
    """

    def __init__(
        self,
        beacon_positions: Optional[dict] = None,
        q_rssi: float = 4.0565,
        r_rssi: float = 1.9188,
        q_position: float = 0.01,
        r_position: float = 1.0,
        beacon_timeout_s: float = 5.0,
    ) -> None:
        """
        beacon_positions: { beacon_id: {"name": str, "x": float, "y": float} }
            Known anchor coordinates. Beacons not in this dict are ignored
            (call add_beacon() later if you discover them dynamically).
        q_rssi, r_rssi: noise params for per-beacon RSSI Kalman filters.
        q_position, r_position: initial noise params for the 2D position KF.
        beacon_timeout_s: prune a beacon (and its filter) after this many
            seconds of no readings.
        """
        self._beacon_positions: dict = dict(beacon_positions or {})
        self._q_rssi = float(q_rssi)
        self._r_rssi = float(r_rssi)
        self._beacon_timeout_s = float(beacon_timeout_s)

        self._filters: dict = {}            # beacon_id → RssiKalmanFilter
        self._last_filtered: dict = {}      # beacon_id → latest filtered RSSI
        self._last_seen: dict = {}          # beacon_id → time.time() of last reading

        self._position_kf = AdaptiveKalmanFilter(
            q_value=q_position, r_value=r_position
        )
        self._last_result: Optional[dict] = None

        self._lock = threading.Lock()

    # ── Beacon registry ─────────────────────────────────────────────

    def add_beacon(self, beacon_id: str, name: str, x: float, y: float) -> None:
        """Register or update a beacon's known position."""
        with self._lock:
            self._beacon_positions[beacon_id] = {
                "name": str(name),
                "x": float(x),
                "y": float(y),
            }

    def remove_beacon(self, beacon_id: str) -> None:
        with self._lock:
            self._beacon_positions.pop(beacon_id, None)
            self._filters.pop(beacon_id, None)
            self._last_filtered.pop(beacon_id, None)
            self._last_seen.pop(beacon_id, None)

    # ── Stage 1: ingest raw RSSI ────────────────────────────────────

    def on_rssi_received(self, beacon_id: str, rssi: float) -> Optional[float]:
        """
        Push one raw RSSI reading from one beacon. Returns the filtered
        RSSI value (or None if the beacon isn't registered).

        Call this every time a BLE advertisement arrives — high frequency.
        """
        with self._lock:
            if beacon_id not in self._beacon_positions:
                return None  # unknown beacon, ignore silently

            kf = self._filters.get(beacon_id)
            if kf is None:
                kf = RssiKalmanFilter(q_value=self._q_rssi, r_value=self._r_rssi)
                self._filters[beacon_id] = kf

            filtered = kf.update(rssi)
            self._last_filtered[beacon_id] = filtered
            self._last_seen[beacon_id] = time.time()
            return filtered

    # ── Stage 2: compute current position ───────────────────────────

    def update_position(self) -> Optional[dict]:
        """
        Compute the current smoothed position from the latest cached
        filtered RSSI per beacon. Call this on a fixed schedule (e.g.
        every 0.5 s) regardless of how often RSSI events arrive.

        Returns None when fewer than 3 beacons have recent data, or
        when trilateration fails (collinear / overlapping anchors).

        Returned dict shape:
            {
                "raw_position":    {"x": float, "y": float},
                "smooth_position": {"x": float, "y": float},
                "distances":       {beacon_label: float, ...},
                "active_beacons":  [beacon_id, ...],
                "converged":       bool,
                "timestamp":       float,
            }
        """
        with self._lock:
            self._prune_stale_locked()

            beacons_list = []
            for beacon_id, rssi in self._last_filtered.items():
                cfg = self._beacon_positions.get(beacon_id)
                if cfg is None:
                    continue
                beacons_list.append(
                    {
                        "id": beacon_id,
                        "name": cfg.get("name", beacon_id),
                        "x": cfg["x"],
                        "y": cfg["y"],
                        "rssi": rssi,
                    }
                )

            if len(beacons_list) < 3:
                return None

            try:
                distances_dict, raw_x, raw_y = trilaterate_with_positions(
                    beacons_list
                )
            except ValueError:
                return None

            smooth_x, smooth_y = self._position_kf.step([raw_x, raw_y])

            result = {
                "raw_position": {"x": round(raw_x, 4), "y": round(raw_y, 4)},
                "smooth_position": {
                    "x": round(smooth_x, 4),
                    "y": round(smooth_y, 4),
                },
                "distances": distances_dict,
                "active_beacons": [b["id"] for b in beacons_list],
                "converged": bool(self._position_kf.converged),
                "timestamp": time.time(),
            }
            self._last_result = result
            return result

    # ── Inspection / control ────────────────────────────────────────

    @property
    def last_result(self) -> Optional[dict]:
        """Most recent update_position() output, or None if not computed yet."""
        return self._last_result

    def get_active_beacons(self) -> list:
        """List of beacon_ids that have produced a reading within the timeout."""
        with self._lock:
            self._prune_stale_locked()
            return list(self._last_seen.keys())

    def get_filtered_rssi(self, beacon_id: str) -> Optional[float]:
        """Latest filtered RSSI for one beacon, or None."""
        with self._lock:
            return self._last_filtered.get(beacon_id)

    def reset_position_filter(self) -> None:
        with self._lock:
            self._position_kf.reset()
            self._last_result = None

    def reset_all(self) -> None:
        """Clear every filter and cached value. Beacon registry is kept."""
        with self._lock:
            self._filters.clear()
            self._last_filtered.clear()
            self._last_seen.clear()
            self._position_kf.reset()
            self._last_result = None

    # ── Internals ───────────────────────────────────────────────────

    def _prune_stale_locked(self) -> None:
        """Drop beacons not seen recently. Caller must hold self._lock."""
        cutoff = time.time() - self._beacon_timeout_s
        stale = [bid for bid, t in self._last_seen.items() if t < cutoff]
        for bid in stale:
            self._filters.pop(bid, None)
            self._last_filtered.pop(bid, None)
            self._last_seen.pop(bid, None)
