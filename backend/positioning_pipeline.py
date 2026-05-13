"""
Two-stage pipeline for BLE indoor localization.

Stage 1 — per-beacon RSSI smoothing:
    One RssiKalmanFilter per beacon_id. Absorbs the high-frequency
    noisy RSSI stream coming straight off the BLE radio.

    Each beacon can have its own Q/R noise parameters (measured from
    the RSSI Profile screen). If a beacon has none, the pipeline's
    global default (q_rssi, r_rssi passed to __init__) is used.

Stage 2 — position smoothing:
    Rolling median filter over the trilaterated (x, y). x and y are
    smoothed independently so a single outlier on either axis cannot
    drag the reported position. The window size is POSITION_MEDIAN_WINDOW
    (see config.py).

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
        → calls trilaterate_with_positions()  (weighted LSQ by RSSI)
        → pushes raw (x, y) into rolling-window median filter
        → returns smoothed position (or None when < 3 active beacons)
"""

import time
import threading
import statistics
from collections import deque
from typing import Optional

from config import POSITION_MEDIAN_WINDOW
from debug_log import debug_log
from rssi_kalman import RssiKalmanFilter
from trilateration import trilaterate_with_positions

# Hysteresis: after stage 1 KF, only swap a beacon out of the active 3 if a
# challenger is at least this many dB stronger than the weakest active one.
# Prevents rapid beacon flipping when filtered RSSI values are close.
HYSTERESIS_THRESHOLD = 10.0
TOP_N = 3


class PositioningPipeline:
    """
    End-to-end pipeline: raw RSSI → per-beacon Kalman → distance →
    weighted-LSQ trilateration → rolling-window median → smoothed (x, y).

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
            Entries may optionally include "q" and "r" floats to override
            the global RSSI Kalman noise params for that beacon.
        q_rssi, r_rssi: GLOBAL fallback noise params for per-beacon RSSI
            Kalman filters. Used only when a beacon has no specific q/r set.
        q_position, r_position: accepted for backward compatibility with
            callers that still pass position-Kalman tuning. They are NOT
            used — stage 2 is a median filter and has no Q/R.
        beacon_timeout_s: prune a beacon (and its filter) after this many
            seconds of no readings.
        """
        del q_position, r_position  # legacy args, intentionally ignored

        self._beacon_positions: dict = {}
        self._beacon_kf_params: dict = {}   # beacon_id → {"q": float, "r": float}
        for bid, cfg in (beacon_positions or {}).items():
            self._beacon_positions[bid] = {
                "name": str(cfg.get("name", bid)),
                "x": float(cfg["x"]),
                "y": float(cfg["y"]),
            }
            q_b, r_b = self._extract_qr(cfg)
            if q_b is not None or r_b is not None:
                self._beacon_kf_params[bid] = {
                    "q": q_b if q_b is not None else float(q_rssi),
                    "r": r_b if r_b is not None else float(r_rssi),
                }

        self._q_rssi = float(q_rssi)
        self._r_rssi = float(r_rssi)
        self._beacon_timeout_s = float(beacon_timeout_s)

        self._filters: dict = {}            # beacon_id → RssiKalmanFilter
        self._last_filtered: dict = {}      # beacon_id → latest filtered RSSI
        self._last_seen: dict = {}          # beacon_id → time.time() of last reading

        self._position_window_x: deque = deque(maxlen=POSITION_MEDIAN_WINDOW)
        self._position_window_y: deque = deque(maxlen=POSITION_MEDIAN_WINDOW)
        self._last_result: Optional[dict] = None

        # Hysteresis state: ids of the beacons we used last time, so we can
        # require a strong RSSI margin before swapping any of them out.
        self._last_active_ids: list = []

        self._lock = threading.Lock()

    # ── Beacon registry ─────────────────────────────────────────────

    @staticmethod
    def _extract_qr(entry: dict):
        """Pull optional q/r floats from a beacon dict. Returns (q|None, r|None)."""
        q_raw = entry.get("q")
        r_raw = entry.get("r")
        try:
            q_val = float(q_raw) if q_raw is not None else None
        except (TypeError, ValueError):
            q_val = None
        try:
            r_val = float(r_raw) if r_raw is not None else None
        except (TypeError, ValueError):
            r_val = None
        return q_val, r_val

    def add_beacon(
        self,
        beacon_id: str,
        name: str,
        x: float,
        y: float,
        q: Optional[float] = None,
        r: Optional[float] = None,
    ) -> None:
        """Register or update a beacon's known position (and optional Kalman params)."""
        with self._lock:
            self._beacon_positions[beacon_id] = {
                "name": str(name),
                "x": float(x),
                "y": float(y),
            }
            if q is not None or r is not None:
                self._beacon_kf_params[beacon_id] = {
                    "q": float(q) if q is not None else self._q_rssi,
                    "r": float(r) if r is not None else self._r_rssi,
                }
                # Drop any cached filter so the new noise params take effect on
                # the next reading rather than persisting the old Q/R covariance.
                self._filters.pop(beacon_id, None)

    def remove_beacon(self, beacon_id: str) -> None:
        with self._lock:
            self._beacon_positions.pop(beacon_id, None)
            self._beacon_kf_params.pop(beacon_id, None)
            self._filters.pop(beacon_id, None)
            self._last_filtered.pop(beacon_id, None)
            self._last_seen.pop(beacon_id, None)

    def replace_beacons(self, beacons: list) -> None:
        """
        Wipe the registry and replace it with a fresh set of beacons.
        `beacons` is a list of dicts with keys: id, name, x, y, and
        optionally `q` and `r` (per-beacon 1D Kalman noise overrides).

        Per-beacon RSSI filters are cleared so a new tracking session
        starts cold. The position median filter is NOT reset here —
        call reset_position_filter() if you want that too.
        """
        with self._lock:
            self._beacon_positions = {}
            self._beacon_kf_params.clear()
            self._filters.clear()
            self._last_filtered.clear()
            self._last_seen.clear()
            self._last_active_ids = []
            for b in beacons:
                bid = str(b.get("id") or b.get("name") or "").strip()
                if not bid:
                    continue
                self._beacon_positions[bid] = {
                    "name": str(b.get("name") or bid),
                    "x": float(b["x"]),
                    "y": float(b["y"]),
                }
                q_b, r_b = self._extract_qr(b)
                if q_b is not None or r_b is not None:
                    self._beacon_kf_params[bid] = {
                        "q": q_b if q_b is not None else self._q_rssi,
                        "r": r_b if r_b is not None else self._r_rssi,
                    }

    # ── Stage 1: ingest raw RSSI ────────────────────────────────────

    def on_rssi_received(self, beacon_id: str, rssi: float) -> Optional[float]:
        """
        Push one raw RSSI reading from one beacon. Returns the filtered
        RSSI value (or None if the beacon isn't registered).

        Call this every time a BLE advertisement arrives — high frequency.
        """
        with self._lock:
            return self._ingest_one_locked(beacon_id, rssi)

    def ingest_events(self, events: list) -> int:
        """
        Batch entry point — feed a list of {beacon_id, rssi} dicts into the
        per-beacon filters in one lock acquisition. Returns the number of
        events actually applied (unknown beacons are silently dropped).
        """
        if not events:
            return 0
        applied = 0
        with self._lock:
            filtered_preview = []
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                bid = ev.get("beacon_id") or ev.get("id")
                if bid is None:
                    continue
                rssi = ev.get("rssi")
                if rssi is None:
                    continue
                try:
                    bid = str(bid)
                    rssi_f = float(rssi)
                except (TypeError, ValueError):
                    continue
                filtered = self._ingest_one_locked(bid, rssi_f)
                if filtered is not None:
                    applied += 1
                    if len(filtered_preview) < 5:
                        filtered_preview.append(
                            {
                                "beacon_id": bid,
                                "rawRssi": rssi_f,
                                "filteredRssi": round(filtered, 4),
                            }
                        )
            # region agent log
            debug_log(
                "backend/positioning_pipeline.py:171",
                "pipeline filtered rssi batch",
                {
                    "applied": applied,
                    "registeredBeaconCount": len(self._beacon_positions),
                    "activeBeaconCount": len(self._last_seen),
                    "filteredPreview": filtered_preview,
                },
                hypothesis_id="H2",
            )
            # endregion
        return applied

    def _ingest_one_locked(self, beacon_id: str, rssi: float) -> Optional[float]:
        """Caller MUST hold self._lock."""
        if beacon_id not in self._beacon_positions:
            return None  # unknown beacon, ignore silently

        kf = self._filters.get(beacon_id)
        if kf is None:
            override = self._beacon_kf_params.get(beacon_id)
            q_for_beacon = override["q"] if override else self._q_rssi
            r_for_beacon = override["r"] if override else self._r_rssi
            kf = RssiKalmanFilter(q_value=q_for_beacon, r_value=r_for_beacon)
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

            candidates = []
            for beacon_id, rssi in self._last_filtered.items():
                cfg = self._beacon_positions.get(beacon_id)
                if cfg is None:
                    continue
                candidates.append(
                    {
                        "id": beacon_id,
                        "name": cfg.get("name", beacon_id),
                        "x": cfg["x"],
                        "y": cfg["y"],
                        "rssi": rssi,
                    }
                )

            beacons_list = self._select_top_n_with_hysteresis_locked(candidates)
            self._last_active_ids = [b["id"] for b in beacons_list]

            if len(beacons_list) < 3:
                # region agent log
                debug_log(
                    "backend/positioning_pipeline.py:237",
                    "update position insufficient active beacons",
                    {
                        "activeBeaconCount": len(beacons_list),
                        "activeBeacons": [b["id"] for b in beacons_list],
                    },
                    hypothesis_id="H2",
                )
                # endregion
                return None

            try:
                distances_dict, raw_x, raw_y = trilaterate_with_positions(
                    beacons_list
                )
            except ValueError:
                # region agent log
                debug_log(
                    "backend/positioning_pipeline.py:251",
                    "update position trilateration failed",
                    {
                        "activeBeaconCount": len(beacons_list),
                        "activeBeacons": [b["id"] for b in beacons_list],
                    },
                    hypothesis_id="H5",
                )
                # endregion
                return None

            self._position_window_x.append(raw_x)
            self._position_window_y.append(raw_y)
            smooth_x = float(statistics.median(self._position_window_x))
            smooth_y = float(statistics.median(self._position_window_y))
            window_full = (
                len(self._position_window_x) >= POSITION_MEDIAN_WINDOW
            )

            # region agent log
            debug_log(
                "backend/positioning_pipeline.py:265",
                "position median step",
                {
                    "rawPosition": {"x": round(raw_x, 4), "y": round(raw_y, 4)},
                    "smoothPosition": {
                        "x": round(smooth_x, 4),
                        "y": round(smooth_y, 4),
                    },
                    "windowSize": POSITION_MEDIAN_WINDOW,
                    "windowFill": len(self._position_window_x),
                    "converged": window_full,
                },
                hypothesis_id="H4",
            )
            # endregion

            result = {
                "raw_position": {"x": round(raw_x, 4), "y": round(raw_y, 4)},
                "smooth_position": {
                    "x": round(smooth_x, 4),
                    "y": round(smooth_y, 4),
                },
                "distances": distances_dict,
                "active_beacons": [b["id"] for b in beacons_list],
                "converged": window_full,
                "timestamp": time.time(),
            }
            self._last_result = result
            return result

    def _select_top_n_with_hysteresis_locked(self, all_beacons: list) -> list:
        """Pick TOP_N beacons by filtered RSSI with hysteresis.

        A challenger only replaces a currently-active beacon if its filtered
        RSSI is at least HYSTERESIS_THRESHOLD dB stronger than the weakest
        currently-active beacon. Caller MUST hold self._lock.
        """
        if len(all_beacons) <= TOP_N:
            return list(all_beacons)

        beacon_map = {b["id"]: b for b in all_beacons}
        active = [
            beacon_map[bid] for bid in self._last_active_ids if bid in beacon_map
        ]

        if len(active) < TOP_N:
            # No stable history yet — fall back to strongest TOP_N by RSSI.
            return sorted(all_beacons, key=lambda b: b["rssi"], reverse=True)[:TOP_N]

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
        """Clear the position median window so a fresh session starts cold."""
        with self._lock:
            self._position_window_x.clear()
            self._position_window_y.clear()
            self._last_result = None
            self._last_active_ids = []

    def reset_all(self) -> None:
        """Clear every filter and cached value. Beacon registry is kept."""
        with self._lock:
            self._filters.clear()
            self._last_filtered.clear()
            self._last_seen.clear()
            self._position_window_x.clear()
            self._position_window_y.clear()
            self._last_result = None
            self._last_active_ids = []

    def set_position_kalman_params(
        self, q: Optional[float] = None, r: Optional[float] = None
    ) -> None:
        """Deprecated no-op.

        Kept so the legacy /pipeline/kalman/update endpoint does not 500.
        Stage 2 is now a median filter with no tunable noise parameters.
        """
        del q, r

    def set_beacon_kalman_params(
        self,
        beacon_id: str,
        q: Optional[float] = None,
        r: Optional[float] = None,
    ) -> bool:
        """Live-tune the per-beacon 1D Kalman Q/R for `beacon_id`.

        Returns True if the beacon was registered and its filter was
        rebuilt with the new params; False if the beacon is unknown.
        Passing both q and r as None clears the override and the beacon
        falls back to the pipeline's global default.
        """
        with self._lock:
            if beacon_id not in self._beacon_positions:
                return False
            if q is None and r is None:
                self._beacon_kf_params.pop(beacon_id, None)
            else:
                existing = self._beacon_kf_params.get(beacon_id, {})
                self._beacon_kf_params[beacon_id] = {
                    "q": float(q) if q is not None else existing.get("q", self._q_rssi),
                    "r": float(r) if r is not None else existing.get("r", self._r_rssi),
                }
            # Force a rebuild so the new noise params take effect immediately.
            self._filters.pop(beacon_id, None)
            return True

    def get_beacon_kalman_params(self, beacon_id: str) -> dict:
        """Return the Q/R the pipeline would use for this beacon right now."""
        with self._lock:
            override = self._beacon_kf_params.get(beacon_id)
            if override:
                return {
                    "q": override["q"],
                    "r": override["r"],
                    "source": "beacon_override",
                }
            return {
                "q": self._q_rssi,
                "r": self._r_rssi,
                "source": "global_default",
            }

    def get_status(self) -> dict:
        """
        Diagnostic snapshot of the pipeline. Useful for inspecting which
        beacons are active, what their filtered RSSI is, and how full the
        position median window currently is.
        """
        with self._lock:
            self._prune_stale_locked()
            window_full = (
                len(self._position_window_x) >= POSITION_MEDIAN_WINDOW
            )
            per_beacon_params = {
                bid: {"q": p["q"], "r": p["r"]}
                for bid, p in self._beacon_kf_params.items()
            }
            return {
                "registered_beacons": list(self._beacon_positions.keys()),
                "active_beacons": list(self._last_seen.keys()),
                "filtered_rssi": dict(self._last_filtered),
                "rssi_q": self._q_rssi,
                "rssi_r": self._r_rssi,
                "beacon_kalman_params": per_beacon_params,
                "position_median_window": POSITION_MEDIAN_WINDOW,
                "position_window_fill": len(self._position_window_x),
                "converged": window_full,
                "last_result": self._last_result,
                "beacon_timeout_s": self._beacon_timeout_s,
            }

    # ── Internals ───────────────────────────────────────────────────

    def _prune_stale_locked(self) -> None:
        """Drop beacons not seen recently. Caller must hold self._lock."""
        cutoff = time.time() - self._beacon_timeout_s
        stale = [bid for bid, t in self._last_seen.items() if t < cutoff]
        for bid in stale:
            self._filters.pop(bid, None)
            self._last_filtered.pop(bid, None)
            self._last_seen.pop(bid, None)
