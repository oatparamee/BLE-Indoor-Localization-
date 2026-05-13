"""
Fingerprint matcher — Gaussian log-likelihood over surveyed grid cells.

For each cell c with per-beacon (mu_b, sigma_b^2):

    log L(c | z) = sum_b [ -0.5 * ((z_b - mu_b)^2 / sigma_b^2
                                   + log(2 pi sigma_b^2)) ]

Beacons stored as `null` at a cell (not heard during the survey) are
treated as having mean = global floor RSSI and a fixed wide sigma
(FLOOR_SIGMA) so a "not heard here either" observation supports that
cell instead of catastrophically penalising it.

Incoming observation z_b that is None (beacon not heard right now)
substitutes the same floor — keeps the measurement vector dimension
equal to #beacons, which is what the downstream KF expects.

Position estimate = weighted centroid over the top-K cells, weights
exp(loglik - max_loglik). Returns the best cell as a tiebreaker when
only one cell exists.
"""

import math
from typing import Optional


# Std (dBm) assumed for floor-substituted beacons. Wide enough that a
# missing beacon contributes information but does not dominate.
FLOOR_SIGMA = 6.0

# Variance floor (dBm^2). Cells with near-zero observed variance would
# otherwise make the Gaussian arbitrarily peaked.
SIGMA_FLOOR = 1.0

# Number of cells averaged for the centroid.
TOP_K_DEFAULT = 4


def match(
    store,
    rssi_vector: dict,
    top_k: int = TOP_K_DEFAULT,
) -> Optional[dict]:
    """Return the best-estimate (x, y) plus the top-K cells.

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
    """Lower-level matcher that operates on a precomputed cell list.

    Use this directly when you need to exclude specific cells (e.g.
    leave-one-out cross-validation for R estimation). For normal live
    matching, call match(store, ...).
    """
    if not cells:
        return None

    floor = floor_rssi
    known_bids = set(known_beacons)

    overlap = [b for b in rssi_vector.keys() if b in known_bids]
    if not overlap and floor is None:
        return None

    scored = []
    for cell in cells:
        loglik = 0.0
        contributions = 0
        for bid in known_bids:
            entry = cell.get("beacons", {}).get(bid)
            if entry is None:
                if floor is None:
                    continue
                mu = floor
                sigma2 = FLOOR_SIGMA * FLOOR_SIGMA
            else:
                mu = float(entry["mean"])
                sigma2 = max(float(entry["var"]), SIGMA_FLOOR * SIGMA_FLOOR)

            z = rssi_vector.get(bid)
            if z is None:
                z = floor
                if z is None:
                    continue
            diff = float(z) - mu
            loglik += -0.5 * (diff * diff / sigma2 + math.log(2.0 * math.pi * sigma2))
            contributions += 1

        if contributions == 0:
            continue
        scored.append({"x": cell["x"], "y": cell["y"], "loglik": loglik, "n_beacons": contributions})

    if not scored:
        return None

    scored.sort(key=lambda c: c["loglik"], reverse=True)
    top = scored[: max(1, int(top_k))]
    max_l = top[0]["loglik"]
    weights = [math.exp(c["loglik"] - max_l) for c in top]
    wsum = sum(weights)
    if wsum <= 0:
        # Numerical collapse — fall back to the best cell only.
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
                "loglik": round(c["loglik"], 4),
                "weight": round(w / wsum, 6),
                "n_beacons": c["n_beacons"],
            }
            for w, c in zip(weights, top)
        ],
        "floor_rssi": floor,
    }
