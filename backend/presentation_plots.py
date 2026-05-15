"""
Generate presentation-ready plots from the live survey data.

Reads:
    backend/data/fingerprint.json   (the survey)
    backend/data/beacons.json       (anchor positions)

Writes (PNG, 200 DPI):
    backend/data/plots/01_survey_layout.png
    backend/data/plots/02_rssi_heatmaps.png
    backend/data/plots/03_distance_vs_rssi.png
    backend/data/plots/04_loo_error_map.png
    backend/data/plots/05_loo_error_distribution.png

And a summary file:
    backend/data/plots/r_q_summary.txt

Usage:
    cd backend
    pip install matplotlib            # if not already installed
    python presentation_plots.py
"""

import json
import math
import os
import sys

import matplotlib

matplotlib.use("Agg")  # headless — no GUI needed
import matplotlib.pyplot as plt
import numpy as np

from beacons import BeaconStore
from fingerprint import FingerprintStore
from r_estimator import estimate_r_loo


HERE = os.path.dirname(os.path.abspath(__file__))
PLOTS_DIR = os.path.join(HERE, "data", "plots")
DPI = 200

# 4D KF default — same as fingerprint_pipeline.DEFAULT_SIGMA_A. Surface
# the resulting Q matrix at a couple of common polling cadences so the
# slide can show what "Q" looks like in practice.
SIGMA_A_DEFAULT = 0.5
DT_PRESETS = [0.25, 0.5, 1.0]


def q_matrix(sigma_a: float, dt: float):
    sa2 = sigma_a ** 2
    return sa2 * np.array([
        [dt**4 / 4, 0,         dt**3 / 2, 0        ],
        [0,         dt**4 / 4, 0,         dt**3 / 2],
        [dt**3 / 2, 0,         dt**2,     0        ],
        [0,         dt**3 / 2, 0,         dt**2    ],
    ])


def format_matrix(m, fmt="{:9.4f}"):
    return "\n".join("  [" + " ".join(fmt.format(v) for v in row) + "]" for row in m)


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)

    fp_store = FingerprintStore()
    bcn_store = BeaconStore()

    cells = fp_store.list_cells()
    if not cells:
        print("ERROR: no surveyed cells in fingerprint.json", file=sys.stderr)
        sys.exit(1)

    beacons = bcn_store.list()  # [{id, name, x, y, ...}, ...]
    beacons_by_id = {b["id"]: b for b in beacons}
    floor = fp_store.floor_rssi()
    summary = fp_store.summary()

    print(f"Loaded {len(cells)} surveyed cells, {len(beacons)} anchors,"
          f" floor RSSI = {floor:.2f} dBm")

    # Sort beacons by name so multipanel plots have a stable order.
    beacons_sorted = sorted(beacons, key=lambda b: b["name"])
    beacon_ids = [b["id"] for b in beacons_sorted]
    beacon_names = [b["name"] for b in beacons_sorted]

    # ── Cell coordinate arrays ────────────────────────────────────
    cx = np.array([c["x"] for c in cells], dtype=float)
    cy = np.array([c["y"] for c in cells], dtype=float)

    # ── 1. Survey layout map ──────────────────────────────────────
    heard_per_cell = np.array([
        sum(1 for v in c["beacons"].values() if v is not None) for c in cells
    ])

    fig, ax = plt.subplots(figsize=(14, 8))
    sc = ax.scatter(cx, cy, c=heard_per_cell, cmap="viridis",
                    s=80, edgecolors="black", linewidths=0.5, zorder=2)
    cb = plt.colorbar(sc, ax=ax)
    cb.set_label("Beacons heard at this point")

    for b in beacons:
        ax.scatter(b["x"], b["y"], s=240, marker="^",
                   facecolors="red", edgecolors="black", linewidths=1.5, zorder=3)
        ax.annotate(b["name"], (b["x"], b["y"]), xytext=(8, 8),
                    textcoords="offset points", fontsize=8, color="darkred")

    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.set_title(f"Survey layout — {len(cells)} points, {len(beacons)} beacons")
    ax.set_aspect("equal", adjustable="datalim")
    ax.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "01_survey_layout.png"), dpi=DPI)
    plt.close()
    print("  wrote 01_survey_layout.png")

    # ── 2. Per-beacon RSSI heatmaps (multi-panel) ─────────────────
    n_beacons = len(beacon_ids)
    ncols = 4
    nrows = math.ceil(n_beacons / ncols)
    fig, axes = plt.subplots(nrows, ncols, figsize=(4 * ncols, 3.5 * nrows),
                             squeeze=False)
    for idx, bid in enumerate(beacon_ids):
        ax = axes[idx // ncols][idx % ncols]
        means = []
        xs, ys = [], []
        for c in cells:
            entry = c["beacons"].get(bid)
            if entry is None:
                continue
            means.append(float(entry["mean"]))
            xs.append(c["x"])
            ys.append(c["y"])
        if not means:
            ax.set_title(f"{beacon_names[idx]} (no data)", fontsize=9)
            ax.axis("off")
            continue
        sc = ax.scatter(xs, ys, c=means, cmap="plasma", s=30,
                        vmin=-95, vmax=-40)
        anchor = beacons_by_id.get(bid)
        if anchor:
            ax.scatter(anchor["x"], anchor["y"], s=80, marker="^",
                       facecolors="white", edgecolors="black", linewidths=1.5)
        ax.set_title(f"{beacon_names[idx]}", fontsize=9)
        ax.set_aspect("equal", adjustable="datalim")
        ax.tick_params(labelsize=7)
        plt.colorbar(sc, ax=ax, shrink=0.7).ax.tick_params(labelsize=6)

    for j in range(n_beacons, nrows * ncols):
        axes[j // ncols][j % ncols].axis("off")

    fig.suptitle("Per-beacon mean RSSI across surveyed points (dBm)",
                 fontsize=12, y=1.00)
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "02_rssi_heatmaps.png"), dpi=DPI,
                bbox_inches="tight")
    plt.close()
    print("  wrote 02_rssi_heatmaps.png")

    # ── 3. Distance vs RSSI (path-loss view) ──────────────────────
    fig, ax = plt.subplots(figsize=(10, 6))
    cmap = plt.cm.tab20
    for i, bid in enumerate(beacon_ids):
        anchor = beacons_by_id.get(bid)
        if anchor is None:
            continue
        dists, means = [], []
        for c in cells:
            entry = c["beacons"].get(bid)
            if entry is None:
                continue
            d = math.hypot(c["x"] - anchor["x"], c["y"] - anchor["y"])
            if d < 0.1:
                continue
            dists.append(d)
            means.append(float(entry["mean"]))
        if not dists:
            continue
        ax.scatter(dists, means, color=cmap(i % 20), s=18,
                   alpha=0.6, label=beacon_names[i])

    ax.set_xscale("log")
    ax.set_xlabel("Distance from beacon (m, log scale)")
    ax.set_ylabel("Mean RSSI at cell (dBm)")
    ax.set_title("Path-loss view — cell mean RSSI vs. straight-line distance")
    ax.grid(True, which="both", alpha=0.3)
    ax.legend(fontsize=7, ncols=2, loc="lower left")
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "03_distance_vs_rssi.png"), dpi=DPI)
    plt.close()
    print("  wrote 03_distance_vs_rssi.png")

    # ── LOO cross-validation ──────────────────────────────────────
    print("Running leave-one-out cross-validation...")
    loo = estimate_r_loo(fp_store, top_k=4)
    if loo is None:
        print("WARNING: not enough cells for LOO — skipping error plots")
        loo = None
    else:
        print(f"  RMSE = {loo['rmse']:.3f} m, n = {loo['n_samples']}")

    # ── 4. LOO error map ──────────────────────────────────────────
    if loo:
        rs = loo["per_cell_residuals"]
        tx = np.array([r["truth_x"] for r in rs])
        ty = np.array([r["truth_y"] for r in rs])
        ex = np.array([r["est_x"] for r in rs])
        ey = np.array([r["est_y"] for r in rs])
        err = np.hypot(ex - tx, ey - ty)

        fig, ax = plt.subplots(figsize=(14, 8))
        sc = ax.scatter(tx, ty, c=err, cmap="RdYlGn_r", s=80,
                        edgecolors="black", linewidths=0.5, zorder=2,
                        vmin=0, vmax=max(np.percentile(err, 95), 1.0))
        cb = plt.colorbar(sc, ax=ax)
        cb.set_label("LOO position error (m)")
        # Arrows from truth -> estimate
        ax.quiver(tx, ty, ex - tx, ey - ty, angles="xy", scale_units="xy",
                  scale=1, width=0.002, color="gray", alpha=0.6, zorder=1)
        for b in beacons:
            ax.scatter(b["x"], b["y"], s=180, marker="^",
                       facecolors="red", edgecolors="black", linewidths=1.5,
                       zorder=3)
        ax.set_xlabel("x (m)")
        ax.set_ylabel("y (m)")
        ax.set_title(f"Leave-one-out match error — RMSE = {loo['rmse']:.2f} m")
        ax.set_aspect("equal", adjustable="datalim")
        ax.grid(True, alpha=0.2)
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "04_loo_error_map.png"), dpi=DPI)
        plt.close()
        print("  wrote 04_loo_error_map.png")

        # ── 5. Error histogram + CDF ──────────────────────────────
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.5))
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

        sorted_err = np.sort(err)
        cdf = np.arange(1, len(sorted_err) + 1) / len(sorted_err)
        ax2.plot(sorted_err, cdf, color="#1f77b4", linewidth=2)
        ax2.axhline(0.5, color="gray", linestyle=":", alpha=0.7)
        ax2.axhline(0.9, color="gray", linestyle=":", alpha=0.7)
        p50 = np.percentile(err, 50)
        p90 = np.percentile(err, 90)
        ax2.axvline(p50, color="green", linestyle="--",
                    label=f"50% < {p50:.2f} m")
        ax2.axvline(p90, color="orange", linestyle="--",
                    label=f"90% < {p90:.2f} m")
        ax2.set_xlabel("Position error (m)")
        ax2.set_ylabel("Cumulative fraction of cells")
        ax2.set_title("LOO error CDF")
        ax2.grid(True, alpha=0.3)
        ax2.legend()

        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "05_loo_error_distribution.png"),
                    dpi=DPI)
        plt.close()
        print("  wrote 05_loo_error_distribution.png")

    # ── 6. R / Q summary text file ────────────────────────────────
    summary_lines = []
    summary_lines.append("=" * 68)
    summary_lines.append("  BLE FINGERPRINT — R AND Q SUMMARY")
    summary_lines.append("=" * 68)
    summary_lines.append("")
    summary_lines.append(f"Survey:        {len(cells)} cells")
    summary_lines.append(f"Beacons:       {len(beacons)} configured "
                         f"({summary.get('cell_count')} appear in fingerprint)")
    summary_lines.append(f"Floor RSSI:    {floor:.2f} dBm "
                         "(min observed sample, used for not-heard substitution)")
    summary_lines.append("")
    summary_lines.append("-" * 68)
    summary_lines.append("MEASUREMENT NOISE R (4D KF observes [x, y])")
    summary_lines.append("-" * 68)
    if loo:
        R = np.array(loo["R"])
        summary_lines.append(
            "Estimated from leave-one-out cross-validation on the survey:"
        )
        summary_lines.append("")
        summary_lines.append("  R (m^2) =")
        summary_lines.append(format_matrix(R))
        summary_lines.append("")
        summary_lines.append(f"  variance(x) = {R[0,0]:.4f} m^2  "
                             f"-> std(x) = {math.sqrt(R[0,0]):.3f} m")
        summary_lines.append(f"  variance(y) = {R[1,1]:.4f} m^2  "
                             f"-> std(y) = {math.sqrt(R[1,1]):.3f} m")
        summary_lines.append(f"  covariance  = {R[0,1]:.4f}")
        summary_lines.append("")
        summary_lines.append(f"  Match RMSE  = {loo['rmse']:.3f} m  "
                             f"(n = {loo['n_samples']} cells)")
        summary_lines.append(
            f"  Mean residual = ({loo['mean_residual']['x']:+.3f}, "
            f"{loo['mean_residual']['y']:+.3f}) m  (systematic bias)"
        )
    else:
        summary_lines.append("LOO not run (need >= 4 cells).")
    summary_lines.append("")

    summary_lines.append("-" * 68)
    summary_lines.append(f"PROCESS NOISE Q (constant-velocity, sigma_a = "
                         f"{SIGMA_A_DEFAULT} m/s^2)")
    summary_lines.append("-" * 68)
    summary_lines.append("Continuous white-noise acceleration model:")
    summary_lines.append("  Q(dt) = sigma_a^2 *")
    summary_lines.append("          [[dt^4/4, 0,      dt^3/2, 0     ],")
    summary_lines.append("           [0,      dt^4/4, 0,      dt^3/2],")
    summary_lines.append("           [dt^3/2, 0,      dt^2,   0     ],")
    summary_lines.append("           [0,      dt^3/2, 0,      dt^2  ]]")
    summary_lines.append("")
    summary_lines.append("Sample Q at common polling intervals:")
    for dt in DT_PRESETS:
        Q = q_matrix(SIGMA_A_DEFAULT, dt)
        summary_lines.append("")
        summary_lines.append(f"  dt = {dt} s:")
        summary_lines.append(format_matrix(Q))
    summary_lines.append("")
    summary_lines.append("Tune sigma_a higher to make the filter snappier "
                         "(trust measurements more).")
    summary_lines.append("Tune sigma_a lower to make it smoother / laggier "
                         "(trust the motion model more).")

    summary_path = os.path.join(PLOTS_DIR, "r_q_summary.txt")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(summary_lines) + "\n")
    print(f"  wrote r_q_summary.txt")

    print()
    print(f"All outputs in: {PLOTS_DIR}")


if __name__ == "__main__":
    main()
