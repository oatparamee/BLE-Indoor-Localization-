"""
Fingerprint store — per-(x, y) grid cell RSSI distributions for each beacon.

Each surveyed cell holds, per beacon, the mean / variance / count of the
raw RSSI samples collected while the user stood at that coordinate, plus
the raw sample list so we can rebuild stats or render histograms later.
Beacons that produced zero readings at a cell are stored as `null` and
are resolved to the global floor RSSI at match time.

Floor RSSI:
    Derived from the smallest observed individual RSSI sample across the
    whole fingerprint, minus FLOOR_MARGIN_DB. Cached and recomputed on
    every cell mutation. The user wanted "the lowest RSSI reading that
    was read" to stand in for not-detected beacons — that is exactly
    what `floor_rssi()` returns when FLOOR_MARGIN_DB = 0.

Persistence:
    JSON at backend/data/fingerprint.json. Cell keys are stringified as
    "x,y" so they survive the dict -> JSON round-trip.
"""

import json
import math
import os
import threading
import time
from typing import Optional

DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "data", "fingerprint.json")
SCHEMA_VERSION = 1

# Subtracted from min observed RSSI to derive the floor used for
# missing beacons. 0 = "use the lowest seen value as-is".
FLOOR_MARGIN_DB = 0.0


def _cell_key(x: float, y: float) -> str:
    return f"{float(x)},{float(y)}"


def _cell_stats(samples: list) -> dict:
    n = len(samples)
    mean = sum(samples) / n
    var = sum((s - mean) ** 2 for s in samples) / n
    return {
        "n": n,
        "mean": round(mean, 4),
        "var": round(var, 4),
        "std": round(math.sqrt(var), 4),
        "min": round(min(samples), 4),
        "max": round(max(samples), 4),
        "samples": [round(float(s), 4) for s in samples],
    }


def _entry_samples(entry) -> list:
    if not isinstance(entry, dict):
        return []
    samples = entry.get("samples")
    if not isinstance(samples, list):
        return []
    out = []
    for sample in samples:
        try:
            out.append(float(sample))
        except (TypeError, ValueError):
            continue
    return out


class FingerprintStore:
    def __init__(self, path: Optional[str] = None, grid_step_m: float = 1.0):
        self.path = path or DEFAULT_PATH
        self.grid_step_m = float(grid_step_m)
        self._lock = threading.Lock()
        self._cells: dict = {}
        self._floor_cache: Optional[float] = None
        self.load()

    # ── Disk I/O ───────────────────────────────────────────────────

    def load(self) -> None:
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                blob = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        with self._lock:
            self._cells = dict(blob.get("cells", {}))
            self.grid_step_m = float(blob.get("grid_step_m", self.grid_step_m))
            self._floor_cache = None

    def save(self) -> None:
        with self._lock:
            blob = {
                "schema_version": SCHEMA_VERSION,
                "grid_step_m": self.grid_step_m,
                "cells": self._cells,
            }
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(blob, f, indent=2)
        os.replace(tmp, self.path)

    # ── Cell mutation ──────────────────────────────────────────────

    def upsert_cell(
        self,
        x: float,
        y: float,
        per_beacon_samples: dict,
        timestamp: Optional[float] = None,
    ) -> dict:
        """Build or merge a cell from {beacon_id: [rssi, ...]}.

        Beacons absent or with an empty sample list are stored as None
        and resolved to the floor RSSI at match time. If the same point is
        saved more than once, new samples are appended to the existing cell
        instead of replacing another phone's upload.
        """
        ts = float(timestamp if timestamp is not None else time.time())
        key = _cell_key(x, y)
        with self._lock:
            existing = self._cells.get(key)
            existing_beacons = (
                existing.get("beacons", {}) if isinstance(existing, dict) else {}
            )
            beacon_ids = set(existing_beacons.keys()) | {
                str(bid) for bid in per_beacon_samples.keys()
            }

            cell = {
                "x": float(x),
                "y": float(y),
                "timestamp": ts,
                "beacons": {},
            }
            for bid in beacon_ids:
                existing_samples = _entry_samples(existing_beacons.get(str(bid)))
                raw_new_samples = per_beacon_samples.get(
                    bid,
                    per_beacon_samples.get(str(bid), []),
                )
                new_samples = []
                for sample in raw_new_samples or []:
                    try:
                        new_samples.append(float(sample))
                    except (TypeError, ValueError):
                        continue
                samples = existing_samples + new_samples
                if not samples:
                    cell["beacons"][str(bid)] = None
                    continue
                cell["beacons"][str(bid)] = _cell_stats(samples)

            self._cells[key] = cell
            self._floor_cache = None
        return cell

    def delete_cell(self, x: float, y: float) -> bool:
        with self._lock:
            removed = self._cells.pop(_cell_key(x, y), None) is not None
            if removed:
                self._floor_cache = None
        return removed

    def clear(self) -> None:
        with self._lock:
            self._cells.clear()
            self._floor_cache = None

    # ── Read accessors ─────────────────────────────────────────────

    def list_cells(self) -> list:
        with self._lock:
            return list(self._cells.values())

    def get_cell(self, x: float, y: float) -> Optional[dict]:
        with self._lock:
            return self._cells.get(_cell_key(x, y))

    def known_beacons(self) -> set:
        with self._lock:
            bids = set()
            for cell in self._cells.values():
                bids.update(cell.get("beacons", {}).keys())
        return bids

    def floor_rssi(self) -> Optional[float]:
        """Smallest observed RSSI across the whole survey (minus margin).
        Returns None if no samples have been recorded yet."""
        with self._lock:
            if self._floor_cache is not None:
                return self._floor_cache
            mins = []
            for cell in self._cells.values():
                for entry in cell.get("beacons", {}).values():
                    if entry is None:
                        continue
                    m = entry.get("min")
                    if m is not None:
                        mins.append(float(m))
            if not mins:
                return None
            self._floor_cache = float(min(mins)) - FLOOR_MARGIN_DB
            return self._floor_cache

    def summary(self) -> dict:
        with self._lock:
            cells = list(self._cells.values())
        beacon_ids = set()
        n_with_data = 0
        n_missing_total = 0
        for c in cells:
            for bid, entry in c.get("beacons", {}).items():
                beacon_ids.add(bid)
                if entry is None:
                    n_missing_total += 1
                else:
                    n_with_data += 1
        return {
            "cell_count": len(cells),
            "beacons": sorted(beacon_ids),
            "grid_step_m": self.grid_step_m,
            "floor_rssi": self.floor_rssi(),
            "cells_x_beacons_with_data": n_with_data,
            "cells_x_beacons_missing": n_missing_total,
        }
