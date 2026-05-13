"""
Measurement-noise (R) estimator for the 4D position Kalman filter.

Leave-one-out cross-validation on the fingerprint grid:

    For each surveyed cell c:
      1. Build a synthetic "live observation" from c's per-beacon means.
      2. Run the matcher against ALL OTHER cells (c is held out).
      3. Residual = matched (x', y') − truth (c.x, c.y).
    R = empirical covariance of the residual vector.

This R reflects the matcher's own accuracy on cells it has seen — exactly
the noise the 4D KF needs to model.

Returns:
    {
      "R": [[var_xx, cov_xy], [cov_xy, var_yy]],
      "n_samples": int,
      "mean_residual": {"x": float, "y": float},
      "rmse": float (m),
      "per_cell_residuals": [{x, y, dx, dy}, ...]
    }
"""

from typing import Optional

import numpy as np

from fingerprint_match import match_cells


def estimate_r_loo(store, top_k: int = 4) -> Optional[dict]:
    cells = store.list_cells()
    if len(cells) < 4:
        return None

    floor = store.floor_rssi()
    known_bids = store.known_beacons()

    residuals = []  # list of (dx, dy, truth_x, truth_y, est_x, est_y)
    for i, held in enumerate(cells):
        # Use the held-out cell's per-beacon mean RSSI as the observation.
        observation = {}
        for bid, entry in (held.get("beacons") or {}).items():
            observation[bid] = None if entry is None else float(entry["mean"])

        rest = cells[:i] + cells[i + 1:]
        result = match_cells(
            cells=rest,
            rssi_vector=observation,
            floor_rssi=floor,
            known_beacons=known_bids,
            top_k=top_k,
        )
        if result is None:
            continue
        dx = float(result["x"]) - float(held["x"])
        dy = float(result["y"]) - float(held["y"])
        residuals.append((dx, dy, float(held["x"]), float(held["y"]),
                          float(result["x"]), float(result["y"])))

    if len(residuals) < 4:
        return None

    arr = np.array([(dx, dy) for dx, dy, *_ in residuals], dtype=float)
    dx = arr[:, 0]
    dy = arr[:, 1]

    # Covariance around zero (we want the noise about the truth, not about
    # the residual mean — a systematic bias is still uncertainty for the KF).
    var_xx = float(np.mean(dx * dx))
    var_yy = float(np.mean(dy * dy))
    cov_xy = float(np.mean(dx * dy))

    rmse = float(np.sqrt(var_xx + var_yy))

    return {
        "R": [[var_xx, cov_xy], [cov_xy, var_yy]],
        "n_samples": len(residuals),
        "mean_residual": {"x": float(np.mean(dx)), "y": float(np.mean(dy))},
        "rmse": rmse,
        "per_cell_residuals": [
            {
                "truth_x": tx, "truth_y": ty,
                "est_x": ex, "est_y": ey,
                "dx": round(d, 4), "dy": round(e, 4),
            }
            for d, e, tx, ty, ex, ey in residuals
        ],
    }
