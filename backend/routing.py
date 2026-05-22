"""
Routing over the walkable-path polyline.

Given the path-constraint segments and two arbitrary points (typically
two beacons), compute the shortest walking route that stays on the
polyline:

  1. Snap each endpoint onto the nearest point of the polyline.
  2. Build a graph — nodes = segment endpoints + the two snap points;
     edges = (sub)segments weighted by Euclidean length.
  3. Dijkstra between the two snap points.
  4. Return the ordered waypoints + total length.

If the polyline is empty, or the two snap points fall on disconnected
components, `reachable` is False and the route degrades to a direct
straight line so the UI still has something to draw.

The same coordinate frame as the beacons / fingerprint is used
throughout (metres).
"""

import heapq
import math
from typing import Optional


# Path endpoints within this distance (m) are treated as the same graph
# node. Guards against a hand-drawn polyline whose shared corners are a
# few mm apart, which would otherwise produce a disconnected graph.
NODE_MERGE_TOL = 0.10


def _seg_len(x1, y1, x2, y2) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _project(px, py, x1, y1, x2, y2):
    """Closest point on segment (x1,y1)-(x2,y2) to (px,py).
    Returns (cx, cy, t) where t in [0,1] is the parameter along it."""
    dx, dy = x2 - x1, y2 - y1
    seg2 = dx * dx + dy * dy
    if seg2 <= 1e-12:
        return (x1, y1, 0.0)
    t = ((px - x1) * dx + (py - y1) * dy) / seg2
    t = max(0.0, min(1.0, t))
    return (x1 + t * dx, y1 + t * dy, t)


class _NodeRegistry:
    """Collapses near-coincident coordinates onto a single canonical
    node so shared polyline corners actually connect in the graph."""

    def __init__(self):
        self._nodes: list = []  # list of (x, y)

    def canonical(self, x: float, y: float) -> tuple:
        for (nx, ny) in self._nodes:
            if math.hypot(nx - x, ny - y) <= NODE_MERGE_TOL:
                return (nx, ny)
        node = (float(x), float(y))
        self._nodes.append(node)
        return node


def _coerce_segments(segments) -> list:
    out = []
    for s in segments or []:
        try:
            if isinstance(s, dict):
                out.append((float(s["x1"]), float(s["y1"]),
                            float(s["x2"]), float(s["y2"])))
            else:
                out.append((float(s[0]), float(s[1]),
                            float(s[2]), float(s[3])))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    return out


def _straight_line(sx, sy, ex, ey, reason: str) -> dict:
    return {
        "waypoints": [{"x": sx, "y": sy}, {"x": ex, "y": ey}],
        "length": round(_seg_len(sx, sy, ex, ey), 4),
        "reachable": False,
        "reason": reason,
    }


def compute_route(segments, start_xy, end_xy) -> dict:
    """Shortest walking route from start_xy to end_xy along `segments`.

    segments: list of (x1,y1,x2,y2) tuples or {x1,y1,x2,y2} dicts.
    start_xy / end_xy: (x, y).

    Returns {waypoints: [{x,y}], length: float, reachable: bool,
             reason?: str}.
    """
    segs = _coerce_segments(segments)
    sx, sy = float(start_xy[0]), float(start_xy[1])
    ex, ey = float(end_xy[0]), float(end_xy[1])

    if not segs:
        return _straight_line(sx, sy, ex, ey, "no walkable path defined")

    # ── Snap start & end onto the nearest point of the polyline ────
    def snap(px, py):
        best = None  # (dist2, seg_index, proj_x, proj_y, t)
        for i, (x1, y1, x2, y2) in enumerate(segs):
            cx, cy, t = _project(px, py, x1, y1, x2, y2)
            d2 = (cx - px) ** 2 + (cy - py) ** 2
            if best is None or d2 < best[0]:
                best = (d2, i, cx, cy, t)
        return best

    _, s_seg, s_px, s_py, s_t = snap(sx, sy)
    _, e_seg, e_px, e_py, e_t = snap(ex, ey)

    # ── Build the graph ────────────────────────────────────────────
    reg = _NodeRegistry()
    # Register snap points first so they win as canonical nodes.
    start_key = reg.canonical(s_px, s_py)
    end_key = reg.canonical(e_px, e_py)

    adj: dict = {}

    def add_edge(ax, ay, bx, by):
        ka = reg.canonical(ax, ay)
        kb = reg.canonical(bx, by)
        if ka == kb:
            return
        w = _seg_len(ka[0], ka[1], kb[0], kb[1])
        adj.setdefault(ka, []).append((kb, w))
        adj.setdefault(kb, []).append((ka, w))

    # Each segment becomes one or more edges. Segments hosting a snap
    # point are split there so the snap point is a real graph node.
    for i, (x1, y1, x2, y2) in enumerate(segs):
        cuts = [(0.0, x1, y1), (1.0, x2, y2)]
        if i == s_seg:
            cuts.append((s_t, s_px, s_py))
        if i == e_seg:
            cuts.append((e_t, e_px, e_py))
        cuts.sort(key=lambda c: c[0])
        for a, b in zip(cuts, cuts[1:]):
            add_edge(a[1], a[2], b[1], b[2])

    # ── Dijkstra ───────────────────────────────────────────────────
    dist = {start_key: 0.0}
    prev: dict = {}
    pq = [(0.0, start_key)]
    while pq:
        d, node = heapq.heappop(pq)
        if d > dist.get(node, math.inf):
            continue
        if node == end_key:
            break
        for nb, w in adj.get(node, []):
            nd = d + w
            if nd < dist.get(nb, math.inf):
                dist[nb] = nd
                prev[nb] = node
                heapq.heappush(pq, (nd, nb))

    if end_key not in dist:
        return _straight_line(
            sx, sy, ex, ey,
            "start and destination are on disconnected path segments",
        )

    # ── Reconstruct the node chain ─────────────────────────────────
    chain = [end_key]
    while chain[-1] != start_key:
        chain.append(prev[chain[-1]])
    chain.reverse()

    # Waypoints: beacon → snap → ...polyline nodes... → snap → beacon.
    # Drop consecutive duplicates so the line is clean.
    waypoints = [{"x": round(sx, 4), "y": round(sy, 4)}]

    def push(x, y):
        x, y = round(float(x), 4), round(float(y), 4)
        if waypoints[-1]["x"] != x or waypoints[-1]["y"] != y:
            waypoints.append({"x": x, "y": y})

    for nx, ny in chain:
        push(nx, ny)
    push(ex, ey)

    # Total length = along-path distance + the two beacon→snap connectors.
    along = dist[end_key]
    connectors = _seg_len(sx, sy, s_px, s_py) + _seg_len(ex, ey, e_px, e_py)

    return {
        "waypoints": waypoints,
        "length": round(along + connectors, 4),
        "reachable": True,
    }
