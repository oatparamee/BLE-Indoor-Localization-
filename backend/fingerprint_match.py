"""
Fingerprint matcher — Euclidean nearest-neighbor in RSSI space.

For each surveyed cell c, compute the squared distance between the live
observation vector z and the cell's stored mean vector μ:

    d²(c, z) = Σ_b (z_b - μ_b)²

Every beacon contributes equally — no per-beacon variance weighting.
Beacons stored as `null` at a cell (not heard during the survey) and
live observations marked None (not heard right now) both substitute the
global floor RSSI, so the measurement vector always has dimension =
#known_beacons and the units are consistent on both sides.

Position estimate = inverse-distance weighted centroid of the top-K
nearest cells. Weights = 1 / (d + ε); an exact match (d = 0) gets the
full weight via the epsilon. With Euclidean weighting, adjacent cells
both contribute meaningfully, so the output interpolates between survey
points rather than snapping to the single best one.
"""

import math
from typing import Optional


# Number of cells averaged for the inverse-distance centroid.
TOP_K_DEFAULT = 4

# Small constant added to the distance before inverting, so an exact
# match (d = 0) doesn't blow up. Also caps the influence of the very
# nearest cell so neighbouring cells still contribute meaningfully.
DISTANCE_EPSILON = 1e-6


def match(
    store,
    rssi_vector: dict,
    top_k: int = TOP_K_DEFAULT,
) -> Optional[dict]:
    """Return the best-estimate (x, y) plus the top-K nearest cells.

    store: FingerprintStore
    rssi_vector: {beacon_id: float|None} — current observation.
        Unknown beacons are ignored; None values are floor-substituted.
    """
    return match_cells(
        cells=store.list_cells(),
        rssi_vector=rssi_vector,
        floor_rssi=store.floor_rssi(),
        known_beacons=store.known_beacons(),
        top_k=top_k,
    )


def match_cells(
    cells: list,
    rssi_vector: dict,
    floor_rssi: Optional[float],
    known_beacons,
    top_k: int = TOP_K_DEFAULT,
) -> Optional[dict]:
    """Lower-level matcher operating on a precomputed cell list.

    Used by leave-one-out cross-validation in r_estimator.py to score
    each cell against the rest. For normal live matching, call match().
    """
    if not cells:
        return None
    if floor_rssi is None:
        # Without a floor we can't substitute missing values, so we
        # can't keep the vector dimension fixed. Refuse to match.
        return None

    floor = float(floor_rssi)
    known_bids = sorted(set(known_beacons))
    if not known_bids:
        return None

    scored = []
    for cell in cells:
        sq_dist = 0.0
        cell_beacons = cell.get("beacons", {})
        for bid in known_bids:
            entry = cell_beacons.get(bid)
            mu = float(entry["mean"]) if isinstance(entry, dict) else floor

            z = rssi_vector.get(bid)
            z_val = float(z) if z is not None else floor

            diff = z_val - mu
            sq_dist += diff * diff
        scored.append({
            "x": cell["x"],
            "y": cell["y"],
            "sq_dist": sq_dist,
            "n_beacons": len(known_bids),
        })

    if not scored:
        return None

    scored.sort(key=lambda c: c["sq_dist"])
    top = scored[: max(1, int(top_k))]

    weights = [1.0 / (math.sqrt(c["sq_dist"]) + DISTANCE_EPSILON) for c in top]
    wsum = sum(weights)
    if wsum <= 0:
        best = top[0]
        return {
            "x": best["x"],
            "y": best["y"],
            "top": [{**best, "weight": 1.0}],
            "floor_rssi": floor,
        }

    x_est = sum(w * c["x"] for w, c in zip(weights, top)) / wsum
    y_est = sum(w * c["y"] for w, c in zip(weights, top)) / wsum

    return {
        "x": round(x_est, 4),
        "y": round(y_est, 4),
        "top": [
            {
                "x": c["x"],
                "y": c["y"],
                "sq_dist": round(c["sq_dist"], 4),
                "distance": round(math.sqrt(c["sq_dist"]), 4),
                "weight": round(w / wsum, 6),
                "n_beacons": c["n_beacons"],
            }
            for w, c in zip(weights, top)
        ],
        "floor_rssi": floor,
    }
