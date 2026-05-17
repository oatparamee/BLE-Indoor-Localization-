"""
Path constraint — clamp a 2D position onto the nearest point of a
polyline. Used by the live fingerprint pipeline so the green dot never
drifts off the walkable corridor into a wall.

The path is a list of straight line segments. Each segment is described
by its two endpoints in the same coordinate frame as the beacon
positions (meters). For any (x, y), `project()` returns the closest
point on any segment — `O(num_segments)` per call, which is fine for
the polylines a building floor uses.

Persistence: JSON at backend/data/path.json. If the file is absent the
class is initialised empty and projection is a no-op (returns the input
unchanged) so a missing config never breaks the pipeline.

The "rogue id" filter and this projector are intentionally separate
concerns: the filter decides which RSSI values count, the projector
decides where the resulting position is allowed to live.
"""

import json
import math
import os
import threading
from typing import Optional, Iterable

DEFAULT_PATH_FILE = os.path.join(os.path.dirname(__file__), "data", "path.json")
SCHEMA_VERSION = 1


def _coerce_segment(seg) -> Optional[tuple]:
    """Normalise a segment from {x1,y1,x2,y2}, [x1,y1,x2,y2], or
    [[x1,y1], [x2,y2]] into (x1, y1, x2, y2). Returns None when the
    payload is malformed so the loader can skip-and-continue."""
    try:
        if isinstance(seg, dict):
            return (
                float(seg["x1"]),
                float(seg["y1"]),
                float(seg["x2"]),
                float(seg["y2"]),
            )
        if isinstance(seg, (list, tuple)) and len(seg) == 4 and not isinstance(seg[0], (list, tuple)):
            return (float(seg[0]), float(seg[1]), float(seg[2]), float(seg[3]))
        if isinstance(seg, (list, tuple)) and len(seg) == 2:
            (x1, y1), (x2, y2) = seg[0], seg[1]
            return (float(x1), float(y1), float(x2), float(y2))
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    return None


def _project_point_to_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> tuple:
    """Closest point on segment (x1,y1)-(x2,y2) to (px, py)."""
    dx = x2 - x1
    dy = y2 - y1
    seg_len2 = dx * dx + dy * dy
    if seg_len2 <= 1e-12:
        return (x1, y1)
    t = ((px - x1) * dx + (py - y1) * dy) / seg_len2
    t = max(0.0, min(1.0, t))
    return (x1 + t * dx, y1 + t * dy)


class PathConstraint:
    def __init__(self, path: Optional[str] = None, segments: Optional[Iterable] = None):
        self.path = path or DEFAULT_PATH_FILE
        self._lock = threading.Lock()
        self._segments: list = []
        if segments is not None:
            self.set_segments(segments)
        else:
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
        raw = blob.get("segments") if isinstance(blob, dict) else None
        if not isinstance(raw, list):
            return
        segments = []
        for seg in raw:
            coerced = _coerce_segment(seg)
            if coerced is not None:
                segments.append(coerced)
        with self._lock:
            self._segments = segments

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with self._lock:
            blob = {
                "schema_version": SCHEMA_VERSION,
                "segments": [
                    {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                    for (x1, y1, x2, y2) in self._segments
                ],
            }
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(blob, f, indent=2)
        os.replace(tmp, self.path)

    # ── Mutation ──────────────────────────────────────────────────

    def set_segments(self, segments: Iterable) -> None:
        cleaned = []
        for seg in segments:
            coerced = _coerce_segment(seg)
            if coerced is not None:
                cleaned.append(coerced)
        with self._lock:
            self._segments = cleaned

    def clear(self) -> None:
        with self._lock:
            self._segments = []

    # ── Read ──────────────────────────────────────────────────────

    def segments(self) -> list:
        with self._lock:
            return [dict(zip(("x1", "y1", "x2", "y2"), s)) for s in self._segments]

    def is_empty(self) -> bool:
        with self._lock:
            return not self._segments

    # ── Projection ────────────────────────────────────────────────

    def project(self, x: float, y: float) -> tuple:
        """Closest point on any configured segment to (x, y).
        If no segments are loaded, returns (x, y) unchanged."""
        with self._lock:
            segments = list(self._segments)
        if not segments:
            return (float(x), float(y))

        best_d2 = math.inf
        best_x = float(x)
        best_y = float(y)
        for (x1, y1, x2, y2) in segments:
            cx, cy = _project_point_to_segment(x, y, x1, y1, x2, y2)
            d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y)
            if d2 < best_d2:
                best_d2 = d2
                best_x, best_y = cx, cy
        return (best_x, best_y)
