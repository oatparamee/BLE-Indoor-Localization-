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


def _normalize_aliases(aliases, primary_name: str = "") -> list:
    """Clean a list of alternate names: strip, drop empties, drop any
    that duplicate the primary name, and dedupe case-insensitively
    (keeping the first spelling seen). Accepts a list or a single
    comma-separated string."""
    if aliases is None:
        return []
    if isinstance(aliases, str):
        aliases = aliases.split(",")
    primary = str(primary_name).strip().lower()
    out: list = []
    seen = set()
    for a in aliases:
        s = str(a).strip()
        low = s.lower()
        if not s or low == primary or low in seen:
            continue
        seen.add(low)
        out.append(s)
    return out


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
        uuid: Optional[str] = None,
        major: Optional[int] = None,
        minor: Optional[int] = None,
        aliases: Optional[list] = None,
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
        # `aliases` — alternate advertised names this physical beacon is
        # known to broadcast. iOS reports a beacon's name inconsistently
        # across phones (advertised localName vs GATT-cached name), so a
        # beacon can legitimately appear under more than one name. Each
        # alias is matched, case-insensitively, by the canonicaliser.
        cleaned_aliases = _normalize_aliases(aliases, primary_name=str(name))
        if cleaned_aliases:
            entry["aliases"] = cleaned_aliases
        if uuid is not None and str(uuid).strip():
            entry["uuid"] = str(uuid).strip().upper()
        if major is not None:
            try:
                entry["major"] = int(major) & 0xFFFF
            except (TypeError, ValueError):
                pass
        if minor is not None:
            try:
                entry["minor"] = int(minor) & 0xFFFF
            except (TypeError, ValueError):
                pass
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

    # ── Lookup helpers used by the live canonicalisation path ─────

    def find_by_ibeacon(
        self,
        uuid: Optional[str],
        major: Optional[int],
        minor: Optional[int],
    ) -> Optional[dict]:
        """Find a beacon by the iBeacon (uuid, major, minor) triple.

        UUID comparison is case-insensitive. Returns None if any of the
        inputs is missing or no beacon matches all three fields.
        """
        if not uuid or major is None or minor is None:
            return None
        try:
            u = str(uuid).strip().upper()
            mj = int(major) & 0xFFFF
            mn = int(minor) & 0xFFFF
        except (TypeError, ValueError):
            return None
        with self._lock:
            for entry in self._beacons.values():
                e_uuid = str(entry.get("uuid", "")).upper()
                if not e_uuid or e_uuid != u:
                    continue
                if int(entry.get("major", -1)) != mj:
                    continue
                if int(entry.get("minor", -1)) != mn:
                    continue
                return dict(entry)
        return None

    def find_by_name(self, name: Optional[str]) -> Optional[dict]:
        """Find a beacon by case-insensitive match against its primary
        name OR any of its aliases."""
        if not name:
            return None
        target = str(name).strip().lower()
        if not target:
            return None
        with self._lock:
            for entry in self._beacons.values():
                if str(entry.get("name", "")).strip().lower() == target:
                    return dict(entry)
                for alias in entry.get("aliases", []):
                    if str(alias).strip().lower() == target:
                        return dict(entry)
        return None
