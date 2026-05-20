"""
Trilateration — geometry-based position from beacon coordinates + RSSI.

Unlike fingerprinting, this needs NO site survey: it works at any
location once the beacon (x, y) coordinates are entered. RSSI is turned
into a distance estimate with a log-distance path-loss model, then the
position is solved by weighted least squares.

    d = 10 ^ ((RSSI_REF - RSSI) / (10 * N))

RSSI_REF — expected RSSI at 1 m (dBm).
N        — path-loss exponent (2.0 open space … 3-4 walls/corridor).

These are generic fixed defaults: they ARE environment-dependent, but a
fixed value is the deliberate trade-off for zero-survey portability.
Tune them per deployment if you want tighter accuracy.
"""

import math
from typing import Optional

import numpy as np


# Generic path-loss defaults — see module docstring.
RSSI_REF = -59.0      # dBm at 1 m
PATH_LOSS_N = 2.5

# Distance clamps so a freak-strong or freak-weak reading can't produce
# a degenerate (≈0) or absurd radius.
MIN_DISTANCE = 0.5    # m
MAX_DISTANCE = 80.0   # m


def rssi_to_distance(
    rssi: float,
    rssi_ref: float = RSSI_REF,
    n: float = PATH_LOSS_N,
) -> float:
    """Log-distance path-loss model. Returns a distance in metres,
    clamped to [MIN_DISTANCE, MAX_DISTANCE]."""
    d = 10.0 ** ((rssi_ref - float(rssi)) / (10.0 * float(n)))
    return max(MIN_DISTANCE, min(MAX_DISTANCE, d))


def trilaterate(anchors) -> Optional[tuple]:
    """Solve a 2D position from anchors = [(x, y, distance), ...].

    Needs at least 3 anchors. Linearises the circle equations by
    subtracting a reference anchor's equation from the others, then
    solves the over-determined system by weighted least squares —
    closer anchors (smaller distance) get more weight because their
    RSSI-to-distance estimate is more reliable.

    Returns (x, y) or None when under-determined / numerically
    degenerate (e.g. all anchors collinear).
    """
    pts = []
    for a in anchors:
        try:
            pts.append((float(a[0]), float(a[1]), float(a[2])))
        except (TypeError, ValueError, IndexError):
            continue
    if len(pts) < 3:
        return None

    # Reference = the anchor with the SMALLEST distance (most reliable),
    # so the subtracted-out equation is the trustworthy one.
    pts.sort(key=lambda p: p[2])
    xr, yr, dr = pts[0]

    rows = []
    rhs = []
    weights = []
    for (xi, yi, di) in pts[1:]:
        # (x-xi)^2+(y-yi)^2 = di^2  minus  (x-xr)^2+(y-yr)^2 = dr^2
        rows.append([2.0 * (xr - xi), 2.0 * (yr - yi)])
        rhs.append(
            di * di - dr * dr
            - xi * xi - yi * yi
            + xr * xr + yr * yr
        )
        # Closer anchor → smaller di → larger weight.
        weights.append(1.0 / max(di * di, 1e-3))

    A = np.array(rows, dtype=float)
    b = np.array(rhs, dtype=float)
    sw = np.sqrt(np.array(weights, dtype=float))
    Aw = A * sw[:, None]
    bw = b * sw

    try:
        sol, _residuals, rank, _sv = np.linalg.lstsq(Aw, bw, rcond=None)
    except np.linalg.LinAlgError:
        return None
    if rank < 2 or sol.shape[0] < 2 or not np.all(np.isfinite(sol)):
        # rank < 2 ⇒ anchors collinear ⇒ position not determined.
        return None

    return (float(sol[0]), float(sol[1]))
