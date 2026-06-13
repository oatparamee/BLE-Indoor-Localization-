"""
Split the two-panel LOO error figure from presentation_plots.py into two
standalone PNGs, so the histogram and the CDF can be placed on separate
slides / report figures.

Reuses the same survey and leave-one-out estimator as presentation_plots.py,
so the numbers match r_q_summary.txt exactly.

Usage:
    cd backend
    python split_loo_distribution.py
Writes:
    backend/data/plots/05a_loo_error_histogram.png
    backend/data/plots/05b_loo_error_cdf.png
"""

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from fingerprint import FingerprintStore
from r_estimator import estimate_r_loo


HERE = os.path.dirname(os.path.abspath(__file__))
PLOTS_DIR = os.path.join(HERE, "data", "plots")
DPI = 200


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)

    loo = estimate_r_loo(FingerprintStore(), top_k=4)
    if loo is None:
        raise SystemExit("Need >= 4 surveyed cells to estimate the LOO error.")

    rs = loo["per_cell_residuals"]
    err = np.hypot(
        np.array([r["est_x"] - r["truth_x"] for r in rs]),
        np.array([r["est_y"] - r["truth_y"] for r in rs]),
    )

    # ── 05a. Histogram ────────────────────────────────────────────────
    fig, ax1 = plt.subplots(figsize=(7, 5))
    ax1.hist(err, bins=20, color="#1f77b4", edgecolor="black", alpha=0.85)
    ax1.axvline(loo["rmse"], color="red", linestyle="--",
                label=f"RMSE = {loo['rmse']:.2f} m")
    ax1.axvline(np.median(err), color="green", linestyle="--",
                label=f"Median = {np.median(err):.2f} m")
    ax1.set_xlabel("Position error (m)")
    ax1.set_ylabel("Number of cells")
    ax1.set_title("LOO error distribution")
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "05a_loo_error_histogram.png"), dpi=DPI)
    plt.close()
    print("  wrote 05a_loo_error_histogram.png")

    # ── 05b. CDF ──────────────────────────────────────────────────────
    sorted_err = np.sort(err)
    cdf = np.arange(1, len(sorted_err) + 1) / len(sorted_err)
    p50 = np.percentile(err, 50)
    p90 = np.percentile(err, 90)

    fig, ax2 = plt.subplots(figsize=(7, 5))
    ax2.plot(sorted_err, cdf, color="#1f77b4", linewidth=2)
    ax2.axhline(0.5, color="gray", linestyle=":", alpha=0.7)
    ax2.axhline(0.9, color="gray", linestyle=":", alpha=0.7)
    ax2.axvline(p50, color="green", linestyle="--", label=f"50% < {p50:.2f} m")
    ax2.axvline(p90, color="orange", linestyle="--", label=f"90% < {p90:.2f} m")
    ax2.set_xlabel("Position error (m)")
    ax2.set_ylabel("Cumulative fraction of cells")
    ax2.set_title("LOO error CDF")
    ax2.grid(True, alpha=0.3)
    ax2.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "05b_loo_error_cdf.png"), dpi=DPI)
    plt.close()
    print("  wrote 05b_loo_error_cdf.png")


if __name__ == "__main__":
    main()
