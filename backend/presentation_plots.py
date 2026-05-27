"""
Generate presentation-ready plots from the live survey data.

Reads:
    backend/data/fingerprint.json   (the survey)
    backend/data/beacons.json       (anchor positions)

Writes (PNG, 200 DPI):
    backend/data/plots/01_survey_layout.png
    backend/data/plots/02_rssi_heatmaps.png
    backend/data/plots/03_distance_vs_rssi.png
    backend/data/plots/03_rssi_histogram.png
    backend/data/plots/03_distance_binned_boxplot.png
    backend/data/plots/03_per_beacon_trends.png
    backend/data/plots/04_loo_error_map.png
    backend/data/plots/05_loo_error_distribution.png
    backend/data/plots/06_path_loss_fit.png
    backend/data/plots/07_per_cell_noise_map.png
    backend/data/plots/08_beacon_coverage.png
    backend/data/plots/09_error_vs_beacons_heard.png
    backend/data/plots/10_error_vs_distance_to_nearest.png
    backend/data/plots/11_residual_ellipses.png

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

    # ── 3. Distance vs RSSI (2D histogram path-loss view) ─────────
    all_dists = []
    all_means = []
    for bid in beacon_ids:
        anchor = beacons_by_id.get(bid)
        if anchor is None:
            continue
        for c in cells:
            entry = c["beacons"].get(bid)
            if entry is None:
                continue
            d = math.hypot(c["x"] - anchor["x"], c["y"] - anchor["y"])
            if d < 0.1:
                continue
            all_dists.append(d)
            all_means.append(float(entry["mean"]))

    if not all_dists:
        print("WARNING: no distance/RSSI pairs found — skipping plot 03")
    else:
        dists_arr = np.array(all_dists, dtype=float)
        means_arr = np.array(all_means, dtype=float)

        # Use log-spaced distance bins so the 2D histogram matches the
        # original path-loss view's log-scaled distance axis.
        dist_bins = np.logspace(
            np.log10(dists_arr.min()),
            np.log10(dists_arr.max()),
            31,
        )
        rssi_bins = np.linspace(means_arr.min(), means_arr.max(), 31)

        fig, ax = plt.subplots(figsize=(10, 6))
        hist = ax.hist2d(dists_arr, means_arr, bins=[dist_bins, rssi_bins], cmap="plasma")
        cb = plt.colorbar(hist[3], ax=ax)
        cb.set_label("Number of cell-beacon pairs")
        ax.set_xscale("log")
        ax.set_xlabel("Distance from beacon (m, log scale)")
        ax.set_ylabel("Mean RSSI at cell (dBm)")
        ax.set_title("Path-loss view — 2D histogram of RSSI vs. distance")
        ax.grid(True, which="both", alpha=0.3)
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "03_distance_vs_rssi.png"), dpi=DPI)
        plt.close()
        print("  wrote 03_distance_vs_rssi.png")

        # ── 3b. RSSI-only histogram ────────────────────────────────
        fig, ax = plt.subplots(figsize=(9, 5))
        ax.hist(means_arr, bins=25, color="#1f77b4", edgecolor="black", alpha=0.85)
        ax.axvline(np.mean(means_arr), color="red", linestyle="--",
                   label=f"Mean = {np.mean(means_arr):.2f} dBm")
        ax.axvline(np.median(means_arr), color="green", linestyle="--",
                   label=f"Median = {np.median(means_arr):.2f} dBm")
        ax.set_xlabel("Mean RSSI at cell (dBm)")
        ax.set_ylabel("Number of cell-beacon pairs")
        ax.set_title("Distribution of mean RSSI values")
        ax.grid(True, alpha=0.3)
        ax.legend()
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "03_rssi_histogram.png"), dpi=DPI)
        plt.close()
        print("  wrote 03_rssi_histogram.png")

        # ── 3c. Distance-binned RSSI boxplot ───────────────────────
        box_bins = np.logspace(
            np.log10(dists_arr.min()),
            np.log10(dists_arr.max()),
            7,
        )
        box_groups = []
        box_labels = []
        for left, right in zip(box_bins[:-1], box_bins[1:]):
            in_bin = (dists_arr >= left) & (dists_arr < right)
            if right == box_bins[-1]:
                in_bin = (dists_arr >= left) & (dists_arr <= right)
            vals = means_arr[in_bin]
            if len(vals) == 0:
                continue
            box_groups.append(vals)
            box_labels.append(f"{left:.1f}-{right:.1f}")

        if box_groups:
            fig, ax = plt.subplots(figsize=(11, 6))
            bp = ax.boxplot(
                box_groups,
                tick_labels=box_labels,
                patch_artist=True,
                showfliers=False,
            )
            for patch in bp["boxes"]:
                patch.set(facecolor="#4C78A8", alpha=0.75)
            for median in bp["medians"]:
                median.set(color="#D62728", linewidth=2)
            ax.set_xlabel("Distance bin from beacon (m)")
            ax.set_ylabel("Mean RSSI at cell (dBm)")
            ax.set_title("Mean RSSI by distance bin")
            ax.grid(True, axis="y", alpha=0.3)
            plt.xticks(rotation=25, ha="right")
            plt.tight_layout()
            plt.savefig(os.path.join(PLOTS_DIR, "03_distance_binned_boxplot.png"),
                        dpi=DPI)
            plt.close()
            print("  wrote 03_distance_binned_boxplot.png")
        else:
            print("WARNING: no populated distance bins — skipping boxplot")

        # ── 3d. Per-beacon trend panels with spread band ────────────
        trend_bins = np.logspace(
            np.log10(dists_arr.min()),
            np.log10(dists_arr.max()),
            9,
        )
        trend_centers = np.sqrt(trend_bins[:-1] * trend_bins[1:])
        ncols = 4
        nrows = math.ceil(n_beacons / ncols)
        fig, axes = plt.subplots(
            nrows,
            ncols,
            figsize=(4.2 * ncols, 3.4 * nrows),
            squeeze=False,
            sharex=True,
            sharey=True,
        )
        for idx, bid in enumerate(beacon_ids):
            ax = axes[idx // ncols][idx % ncols]
            anchor = beacons_by_id.get(bid)
            if anchor is None:
                ax.axis("off")
                continue

            beacon_dists = []
            beacon_means = []
            for c in cells:
                entry = c["beacons"].get(bid)
                if entry is None:
                    continue
                d = math.hypot(c["x"] - anchor["x"], c["y"] - anchor["y"])
                if d < 0.1:
                    continue
                beacon_dists.append(d)
                beacon_means.append(float(entry["mean"]))

            if not beacon_dists:
                ax.set_title(f"{beacon_names[idx]} (no data)", fontsize=9)
                ax.axis("off")
                continue

            bd = np.array(beacon_dists, dtype=float)
            bm = np.array(beacon_means, dtype=float)
            ax.scatter(bd, bm, s=12, alpha=0.25, color="#4C78A8")

            medians = []
            p25 = []
            p75 = []
            centers = []
            for left, right, center in zip(trend_bins[:-1], trend_bins[1:], trend_centers):
                in_bin = (bd >= left) & (bd < right)
                if right == trend_bins[-1]:
                    in_bin = (bd >= left) & (bd <= right)
                vals = bm[in_bin]
                if len(vals) == 0:
                    continue
                centers.append(center)
                medians.append(np.median(vals))
                p25.append(np.percentile(vals, 25))
                p75.append(np.percentile(vals, 75))

            if centers:
                centers = np.array(centers, dtype=float)
                medians = np.array(medians, dtype=float)
                p25 = np.array(p25, dtype=float)
                p75 = np.array(p75, dtype=float)
                ax.plot(centers, medians, color="#D62728", linewidth=2)
                ax.fill_between(centers, p25, p75, color="#D62728", alpha=0.18)

            ax.set_xscale("log")
            ax.set_title(beacon_names[idx], fontsize=9)
            ax.grid(True, which="both", alpha=0.2)
            ax.tick_params(labelsize=7)

        for j in range(n_beacons, nrows * ncols):
            axes[j // ncols][j % ncols].axis("off")

        fig.suptitle("Per-beacon RSSI vs. distance with median trend and IQR",
                     fontsize=12, y=1.00)
        for ax in axes[-1]:
            if ax.axison:
                ax.set_xlabel("Distance (m, log scale)", fontsize=8)
        for row in axes:
            row[0].set_ylabel("Mean RSSI (dBm)", fontsize=8)
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "03_per_beacon_trends.png"), dpi=DPI,
                    bbox_inches="tight")
        plt.close()
        print("  wrote 03_per_beacon_trends.png")

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

    # ── 6. Path-loss model fit ────────────────────────────────────
    if all_dists:
        dists_arr = np.array(all_dists, dtype=float)
        means_arr = np.array(all_means, dtype=float)
        log_d = np.log10(dists_arr)
        # RSSI = A - 10 n log10(d)  ->  linear fit means = A + (-10n)*log10(d)
        slope, intercept = np.polyfit(log_d, means_arr, 1)
        n_path = -slope / 10.0
        A_ref = intercept

        d_grid = np.logspace(np.log10(dists_arr.min()),
                             np.log10(dists_arr.max()), 200)
        rssi_fit = A_ref - 10.0 * n_path * np.log10(d_grid)
        residuals = means_arr - (A_ref - 10.0 * n_path * log_d)
        sigma_pl = float(np.std(residuals))

        fig, ax = plt.subplots(figsize=(10, 6))
        ax.scatter(dists_arr, means_arr, s=10, alpha=0.25,
                   color="#4C78A8", label="Cell-beacon pairs")
        ax.plot(d_grid, rssi_fit, color="#D62728", linewidth=2.2,
                label=f"Fit: RSSI = {A_ref:.1f} − 10·{n_path:.2f}·log10(d)")
        ax.fill_between(d_grid, rssi_fit - sigma_pl, rssi_fit + sigma_pl,
                        color="#D62728", alpha=0.15,
                        label=f"±1σ shadowing = {sigma_pl:.2f} dB")
        ax.set_xscale("log")
        ax.set_xlabel("Distance from beacon (m, log scale)")
        ax.set_ylabel("Mean RSSI (dBm)")
        ax.set_title("Path-loss model fit (log-distance regression)")
        ax.grid(True, which="both", alpha=0.3)
        ax.legend()
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "06_path_loss_fit.png"), dpi=DPI)
        plt.close()
        print(f"  wrote 06_path_loss_fit.png  (n={n_path:.2f}, A={A_ref:.1f},"
              f" sigma={sigma_pl:.2f} dB)")

    # ── 7. Per-cell measurement-noise (mean std across beacons) ────
    cell_std_means = []
    for c in cells:
        stds = [float(v["std"]) for v in c["beacons"].values()
                if v is not None and v.get("std") is not None]
        cell_std_means.append(float(np.mean(stds)) if stds else np.nan)
    cell_std_means = np.array(cell_std_means, dtype=float)

    valid = ~np.isnan(cell_std_means)
    if valid.any():
        fig, ax = plt.subplots(figsize=(14, 8))
        sc = ax.scatter(cx[valid], cy[valid], c=cell_std_means[valid],
                        cmap="magma", s=80, edgecolors="black",
                        linewidths=0.5, zorder=2)
        cb = plt.colorbar(sc, ax=ax)
        cb.set_label("Mean RSSI std at cell (dB)")
        for b in beacons:
            ax.scatter(b["x"], b["y"], s=200, marker="^",
                       facecolors="red", edgecolors="black",
                       linewidths=1.5, zorder=3)
        ax.set_xlabel("x (m)")
        ax.set_ylabel("y (m)")
        ax.set_title("Per-cell measurement noise (avg σ across heard beacons)")
        ax.set_aspect("equal", adjustable="datalim")
        ax.grid(True, alpha=0.2)
        plt.tight_layout()
        plt.savefig(os.path.join(PLOTS_DIR, "07_per_cell_noise_map.png"), dpi=DPI)
        plt.close()
        print("  wrote 07_per_cell_noise_map.png")

    # ── 8. Beacon coverage — cells-heard + samples per beacon ─────
    heard_count = []
    sample_count = []
    for bid in beacon_ids:
        hc = sum(1 for c in cells if c["beacons"].get(bid) is not None)
        sc_n = sum(int(c["beacons"][bid]["n"]) for c in cells
                   if c["beacons"].get(bid) is not None)
        heard_count.append(hc)
        sample_count.append(sc_n)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))
    pos = np.arange(len(beacon_names))
    ax1.bar(pos, heard_count, color="#4C78A8", edgecolor="black")
    ax1.set_xticks(pos)
    ax1.set_xticklabels(beacon_names, rotation=45, ha="right", fontsize=8)
    ax1.set_ylabel(f"Cells where beacon was heard (of {len(cells)})")
    ax1.set_title("Coverage — cells heard per beacon")
    ax1.grid(True, axis="y", alpha=0.3)
    ax1.axhline(len(cells), color="gray", linestyle=":", alpha=0.7)

    ax2.bar(pos, sample_count, color="#F58518", edgecolor="black")
    ax2.set_xticks(pos)
    ax2.set_xticklabels(beacon_names, rotation=45, ha="right", fontsize=8)
    ax2.set_ylabel("Total RSSI samples collected")
    ax2.set_title("Sample volume per beacon")
    ax2.grid(True, axis="y", alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, "08_beacon_coverage.png"), dpi=DPI)
    plt.close()
    print("  wrote 08_beacon_coverage.png")

    # ── 9 / 10 / 11. LOO-dependent diagnostics ────────────────────
    if loo:
        rs = loo["per_cell_residuals"]
        tx = np.array([r["truth_x"] for r in rs])
        ty = np.array([r["truth_y"] for r in rs])
        ex = np.array([r["est_x"] for r in rs])
        ey = np.array([r["est_y"] for r in rs])
        err = np.hypot(ex - tx, ey - ty)
        dx_arr = np.array([r["dx"] for r in rs])
        dy_arr = np.array([r["dy"] for r in rs])

        truth_to_cell = {(round(c["x"], 4), round(c["y"], 4)): c for c in cells}

        n_heard = []
        d_nearest = []
        for txi, tyi in zip(tx, ty):
            cell = truth_to_cell.get((round(float(txi), 4), round(float(tyi), 4)))
            if cell is None:
                n_heard.append(np.nan)
            else:
                n_heard.append(sum(1 for v in cell["beacons"].values()
                                   if v is not None))
            dmin = min((math.hypot(float(txi) - b["x"], float(tyi) - b["y"])
                        for b in beacons), default=np.nan)
            d_nearest.append(dmin)
        n_heard = np.array(n_heard, dtype=float)
        d_nearest = np.array(d_nearest, dtype=float)

        # ── 9. error vs # beacons heard ───────────────────────────
        if np.isfinite(n_heard).any():
            fig, ax = plt.subplots(figsize=(9, 5.5))
            ax.scatter(n_heard, err, s=40, alpha=0.6,
                       color="#4C78A8", edgecolors="black", linewidths=0.4)
            uniq = np.array(sorted({int(v) for v in n_heard
                                    if np.isfinite(v)}))
            med = [np.median(err[n_heard == k]) for k in uniq]
            ax.plot(uniq, med, color="#D62728", linewidth=2, marker="o",
                    label="Median error")
            ax.set_xlabel("Number of beacons heard at the truth cell")
            ax.set_ylabel("LOO position error (m)")
            ax.set_title("Position error vs. beacon visibility")
            ax.grid(True, alpha=0.3)
            ax.legend()
            plt.tight_layout()
            plt.savefig(os.path.join(PLOTS_DIR, "09_error_vs_beacons_heard.png"),
                        dpi=DPI)
            plt.close()
            print("  wrote 09_error_vs_beacons_heard.png")

        # ── 10. error vs distance to nearest beacon ───────────────
        if np.isfinite(d_nearest).any():
            fig, ax = plt.subplots(figsize=(9, 5.5))
            ax.scatter(d_nearest, err, s=40, alpha=0.6,
                       color="#4C78A8", edgecolors="black", linewidths=0.4)
            if len(d_nearest) >= 3:
                order = np.argsort(d_nearest)
                # Coarse running median in 5 bins along distance.
                bins = np.linspace(d_nearest.min(), d_nearest.max(), 6)
                centers, meds = [], []
                for lo, hi in zip(bins[:-1], bins[1:]):
                    sel = (d_nearest >= lo) & (d_nearest <= hi)
                    if sel.any():
                        centers.append(0.5 * (lo + hi))
                        meds.append(np.median(err[sel]))
                if centers:
                    ax.plot(centers, meds, color="#D62728", linewidth=2,
                            marker="o", label="Binned median")
                    ax.legend()
            ax.set_xlabel("Distance from truth cell to nearest beacon (m)")
            ax.set_ylabel("LOO position error (m)")
            ax.set_title("Position error vs. distance to nearest anchor")
            ax.grid(True, alpha=0.3)
            plt.tight_layout()
            plt.savefig(os.path.join(PLOTS_DIR,
                                     "10_error_vs_distance_to_nearest.png"),
                        dpi=DPI)
            plt.close()
            print("  wrote 10_error_vs_distance_to_nearest.png")

        # ── 11. residual scatter with R-matrix confidence ellipses ─
        R = np.array(loo["R"])
        eigvals, eigvecs = np.linalg.eigh(R)
        order = np.argsort(eigvals)[::-1]
        eigvals = eigvals[order]
        eigvecs = eigvecs[:, order]
        angle = math.degrees(math.atan2(eigvecs[1, 0], eigvecs[0, 0]))
        # 2D Gaussian: 1σ ≈ 39%, 2σ ≈ 86%, 3σ ≈ 99% mass containment.
        try:
            from matplotlib.patches import Ellipse
            fig, ax = plt.subplots(figsize=(7.5, 7.5))
            ax.scatter(dx_arr, dy_arr, s=35, alpha=0.6,
                       color="#4C78A8", edgecolors="black", linewidths=0.4,
                       label="Per-cell residual")
            ax.axhline(0, color="gray", linewidth=0.8)
            ax.axvline(0, color="gray", linewidth=0.8)
            for k, color in [(1, "#D62728"), (2, "#F58518"), (3, "#54A24B")]:
                w = 2 * k * math.sqrt(eigvals[0])
                h = 2 * k * math.sqrt(eigvals[1])
                ax.add_patch(Ellipse((0, 0), w, h, angle=angle,
                                     fill=False, color=color, linewidth=1.8,
                                     label=f"{k}σ ellipse"))
            lim = max(np.max(np.abs(dx_arr)), np.max(np.abs(dy_arr))) * 1.15
            ax.set_xlim(-lim, lim)
            ax.set_ylim(-lim, lim)
            ax.set_aspect("equal")
            ax.set_xlabel("Δx (m)  — estimate minus truth")
            ax.set_ylabel("Δy (m)")
            ax.set_title(f"LOO residuals with R-matrix confidence ellipses"
                         f"  (RMSE = {loo['rmse']:.2f} m)")
            ax.grid(True, alpha=0.3)
            ax.legend(loc="upper right", fontsize=9)
            plt.tight_layout()
            plt.savefig(os.path.join(PLOTS_DIR, "11_residual_ellipses.png"),
                        dpi=DPI)
            plt.close()
            print("  wrote 11_residual_ellipses.png")
        except Exception as exc:  # noqa: BLE001
            print(f"WARNING: residual-ellipse plot failed: {exc}")

    # ── 12. R / Q summary text file ────────────────────────────────
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
