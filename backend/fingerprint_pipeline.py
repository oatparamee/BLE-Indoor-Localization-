"""
Fingerprint-based positioning pipeline.

Replaces the legacy (per-beacon 1D KF → trilateration → median) flow with:

    raw RSSI stream
        │
        ▼
    cache latest raw RSSI per beacon (no smoothing — see survey decisions)
        │
        ▼ (periodic — e.g. every 0.5 s)
    fingerprint_match.match(...)        → raw (x_raw, y_raw)
        │
        ▼
    PositionKalmanFilter4D.update(...)  → smoothed (x, y) + velocity (vx, vy)

The pipeline reads its grid (and the floor RSSI) directly from the
FingerprintStore — no separate beacon-registration step is required.
"""

import threading
import time
from typing import Optional

from fingerprint import FingerprintStore
from fingerprint_match import match
from position_kf import PositionKalmanFilter4D
from r_estimator import estimate_r_loo


# Default acceleration std (m/s²) for the constant-velocity process noise.
# Indoor walking with arm-held phone is typically 0.3–0.8.
DEFAULT_SIGMA_A = 0.5


class FingerprintPipeline:
    def __init__(
        self,
        store: FingerprintStore,
        sigma_a: float = DEFAULT_SIGMA_A,
        beacon_timeout_s: float = 5.0,
        top_k: int = 4,
    ):
        self.store = store
        self.kf = PositionKalmanFilter4D(sigma_a=sigma_a)
        self.top_k = int(top_k)
        self.beacon_timeout_s = float(beacon_timeout_s)

        self._lock = threading.Lock()
        self._latest_rssi: dict = {}   # beacon_id → latest raw RSSI
        self._last_seen: dict = {}     # beacon_id → time.time()
        self._r_source: str = "default"
        self._last_r_estimate: Optional[dict] = None
        self._last_result: Optional[dict] = None

    # ── Configuration ─────────────────────────────────────────────

    def seed_r_from_loo(self) -> Optional[dict]:
        """Estimate R via leave-one-out cross-val and apply it. Returns the
        estimator output (incl. RMSE + per-cell residuals) or None when
        the survey is too sparse to cross-validate."""
        estimate = estimate_r_loo(self.store, top_k=self.top_k)
        with self._lock:
            self._last_r_estimate = estimate
            if estimate is None:
                return None
            self.kf.set_r(estimate["R"])
            self._r_source = "loo_cv"
        return estimate

    def set_params(
        self,
        sigma_a: Optional[float] = None,
        r=None,
    ) -> None:
        with self._lock:
            if sigma_a is not None:
                self.kf.set_sigma_a(float(sigma_a))
            if r is not None:
                self.kf.set_r(r)
                self._r_source = "manual"

    def reset(self) -> None:
        with self._lock:
            self._latest_rssi.clear()
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
                self._last_seen[bid] = now
                applied += 1
        return applied

    # ── Compute position ──────────────────────────────────────────

    def update_position(self) -> Optional[dict]:
        with self._lock:
            self._prune_stale_locked()
            if not self._latest_rssi:
                return None

            known = self.store.known_beacons()
            active = set(self._latest_rssi.keys())
            overlap = active & known
            # If no live beacon overlaps the fingerprint dimension every
            # observation slot is None → floor-substituted → every cell
            # gets the same sq_dist → top_cells freeze. Caller wants to
            # know that explicitly so the UI can show why nothing moves.
            if not overlap:
                return {
                    "_no_overlap": True,
                    "active_beacons": sorted(active),
                    "registered_beacons": sorted(known),
                }

            # Include EVERY known beacon: silent ones get None and the
            # matcher floor-substitutes them. This keeps the measurement
            # dimension equal to the survey's beacon count.
            observation = {bid: None for bid in known}
            for bid, rssi in self._latest_rssi.items():
                observation[bid] = rssi

            result = match(self.store, observation, top_k=self.top_k)
            if result is None:
                return None

            now = time.time()
            kf_state = self.kf.update(result["x"], result["y"], now)

            out = {
                "raw_position": {
                    "x": round(result["x"], 4),
                    "y": round(result["y"], 4),
                },
                "smooth_position": {
                    "x": round(kf_state["x"], 4),
                    "y": round(kf_state["y"], 4),
                },
                "velocity": {
                    "vx": round(kf_state["vx"], 4),
                    "vy": round(kf_state["vy"], 4),
                },
                "active_beacons": sorted(active),
                "overlap_beacons": sorted(overlap),
                "top_cells": result["top"],
                "floor_rssi": result["floor_rssi"],
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
                "registered_beacons": sorted(self.store.known_beacons()),
                "active_beacons": sorted(self._latest_rssi.keys()),
                "latest_rssi": dict(self._latest_rssi),
                "sigma_a": self.kf.sigma_a,
                "R": self.kf.R.tolist(),
                "r_source": self._r_source,
                "last_r_estimate": self._last_r_estimate,
                "fingerprint_summary": self.store.summary(),
                "last_result": self._last_result,
                "beacon_timeout_s": self.beacon_timeout_s,
                "top_k": self.top_k,
                "initialized": self.kf.initialized,
            }

    # ── Internals ────────────────────────────────────────────────

    def _prune_stale_locked(self) -> None:
        cutoff = time.time() - self.beacon_timeout_s
        stale = [bid for bid, t in self._last_seen.items() if t < cutoff]
        for bid in stale:
            self._latest_rssi.pop(bid, None)
            self._last_seen.pop(bid, None)
