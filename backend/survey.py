"""
Survey collector — buffers raw RSSI events for active (x, y) cells while
users stand at grid points.

Multiple clients may survey at the same time. Each phone supplies a stable
session_id, so one user's /survey/start cannot replace another user's active
buffer. The collector is independent from the live PositioningPipeline:
survey samples are stored raw (no 1D Kalman smoothing) so the resulting
fingerprint variance reflects the true sensor noise.

Flow:
    POST /survey/start  -> session(session_id, x, y, samples_target)
    POST /survey/events -> append samples to that session's per-beacon buckets
                           (bucket capped at samples_target so an
                            over-eager BLE scanner can't bloat memory)
    GET  /survey/progress -> per-beacon counts vs target for that session
    POST /survey/finalize -> hand that raw buffer to FingerprintStore
                             and clear the active session
    POST /survey/cancel   -> drop that active session, keep nothing
"""

import threading
import time
from typing import Optional


class SurveySession:
    def __init__(self, session_id: str, x: float, y: float, samples_target: int):
        self.session_id = str(session_id)
        self.x = float(x)
        self.y = float(y)
        self.samples_target = max(1, int(samples_target))
        self.started_at = time.time()
        self.buffer: dict = {}  # beacon_id -> list[float]


class SurveyCollector:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, SurveySession] = {}

    def start(
        self,
        x: float,
        y: float,
        samples_target: int,
        session_id: str = "default",
    ) -> dict:
        with self._lock:
            sid = str(session_id or "default")
            self._sessions[sid] = SurveySession(sid, x, y, samples_target)
            return self._snapshot_locked(self._sessions[sid])

    def cancel(self, session_id: str = "default") -> bool:
        with self._lock:
            return self._sessions.pop(str(session_id or "default"), None) is not None

    def is_active(self, session_id: str = "default") -> bool:
        with self._lock:
            return str(session_id or "default") in self._sessions

    def ingest_events(self, events: list, session_id: str = "default") -> int:
        """Append events to the active cell's buffer.

        Returns the number of events that landed in a bucket. Events
        for buckets already at the target count are dropped (no point
        burning more samples on a beacon we've finished surveying).
        """
        if not events:
            return 0
        with self._lock:
            s = self._sessions.get(str(session_id or "default"))
            if s is None:
                return 0
            applied = 0
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
                bucket = s.buffer.setdefault(bid, [])
                if len(bucket) < s.samples_target:
                    bucket.append(rssi_f)
                    applied += 1
            return applied

    def progress(self, session_id: str = "default") -> Optional[dict]:
        with self._lock:
            s = self._sessions.get(str(session_id or "default"))
            if s is None:
                return None
            return self._snapshot_locked(s)

    def take_buffer(self, session_id: str = "default") -> Optional[dict]:
        """Return the raw per-beacon buffer and clear the session.
        None if no active session."""
        with self._lock:
            sid = str(session_id or "default")
            s = self._sessions.get(sid)
            if s is None:
                return None
            data = {
                "session_id": s.session_id,
                "x": s.x,
                "y": s.y,
                "samples_target": s.samples_target,
                "started_at": s.started_at,
                "per_beacon_samples": s.buffer,
            }
            del self._sessions[sid]
            return data

    # ── Internals ──────────────────────────────────────────────────

    def _snapshot_locked(self, s: SurveySession) -> dict:
        per_beacon = {
            bid: {"count": len(samples), "target": s.samples_target}
            for bid, samples in s.buffer.items()
        }
        max_count = max((v["count"] for v in per_beacon.values()), default=0)
        min_count = min((v["count"] for v in per_beacon.values()), default=0)
        return {
            "session_id": s.session_id,
            "x": s.x,
            "y": s.y,
            "samples_target": s.samples_target,
            "started_at": s.started_at,
            "elapsed_s": round(time.time() - s.started_at, 3),
            "per_beacon": per_beacon,
            "max_count": max_count,
            "min_count": min_count,
            "all_full": min_count >= s.samples_target and per_beacon != {},
        }
