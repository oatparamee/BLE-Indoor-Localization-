"""
Beacon registry — persistent {beacon_id → name, x, y, q?, r?} store.

Stored on disk at backend/data/beacons.json. Source of truth for which
anchors the system knows about. The frontend's Setup tab posts changes
here; every other consumer (survey, fingerprint pipeline, legacy
trilateration) reads the same store at startup or on demand.

Same persistence pattern as FingerprintStore: load on init, atomic
write-and-rename on every mutation.
"""

import json
import os
import threading
from typing import Optional

DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "data", "beacons.json")
SCHEMA_VERSION = 1


class BeaconStore:
    def __init__(self, path: Optional[str] = None):
        self.path = path or DEFAULT_PATH
        self._lock = threading.Lock()
        self._beacons: dict = {}  # beacon_id → dict(id, name, x, y, q?, r?)
        self.load()

    # ── Disk I/O ──────────────────────────────────────────────────

    def load(self) -> None:
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                blob = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        with self._lock:
            self._beacons = dict(blob.get("beacons", {}))

    def save(self) -> None:
        with self._lock:
            blob = {
                "schema_version": SCHEMA_VERSION,
                "beacons": self._beacons,
            }
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(blob, f, indent=2)
        os.replace(tmp, self.path)

    # ── Mutation ──────────────────────────────────────────────────

    def upsert(
        self,
        beacon_id: str,
        name: str,
        x: float,
        y: float,
        q: Optional[float] = None,
        r: Optional[float] = None,
    ) -> dict:
        entry = {
            "id": str(beacon_id),
            "name": str(name),
            "x": float(x),
            "y": float(y),
        }
        if q is not None:
            entry["q"] = float(q)
        if r is not None:
            entry["r"] = float(r)
        with self._lock:
            self._beacons[str(beacon_id)] = entry
        return entry

    def delete(self, beacon_id: str) -> bool:
        with self._lock:
            return self._beacons.pop(str(beacon_id), None) is not None

    def clear(self) -> None:
        with self._lock:
            self._beacons.clear()

    # ── Read ──────────────────────────────────────────────────────

    def get(self, beacon_id: str) -> Optional[dict]:
        with self._lock:
            entry = self._beacons.get(str(beacon_id))
            return dict(entry) if entry else None

    def list(self) -> list:
        with self._lock:
            return [dict(b) for b in self._beacons.values()]

    def as_dict(self) -> dict:
        """Return {beacon_id: entry} — same shape the frontend uses."""
        with self._lock:
            return {bid: dict(b) for bid, b in self._beacons.items()}

    def count(self) -> int:
        with self._lock:
            return len(self._beacons)
