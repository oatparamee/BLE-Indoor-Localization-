import argparse
import numpy as np

def rssi_pred(d: float, rssi_1m: float, n: float, wall_loss_db: float = 0.0) -> float:
    """Predict RSSI at distance d (meters) with optional wall loss (dB)."""
    return rssi_1m - 10.0 * n * np.log10(d) - wall_loss_db

def dist_from_rssi(rssi: float, rssi_1m: float, n: float, wall_loss_db: float = 0.0) -> float:
    """Estimate distance (meters) from RSSI with optional wall loss (dB)."""
    return 10.0 ** ((rssi_1m - rssi - wall_loss_db) / (10.0 * n))

def compute_n(d0: float, d1: float, rssi_d0: float, rssi_d1: float) -> float:
    """Estimate path-loss exponent n from two RSSI measurements."""
    return (rssi_d0 - rssi_d1) / (10.0 * np.log10(d1 / d0))

def rssi_at_1m_from_ref(d0: float, rssi_d0: float, n: float) -> float:
    """Convert RSSI measured at d0 to an equivalent RSSI at 1m (no wall loss assumed)."""
    return rssi_d0 + 10.0 * n * np.log10(d0)

def main():
    parser = argparse.ArgumentParser(description="Log-distance RSSI model with optional wall loss.")
    parser.add_argument("--d0", type=float, default=None, help="Reference distance in meters (e.g., 1)")
    parser.add_argument("--d1", type=float, default=None, help="Second distance in meters (e.g., 20)")
    parser.add_argument("--rssi_d0", type=float, default=None, help="RSSI at d0 in dBm (e.g., -61)")
    parser.add_argument("--rssi_d1", type=float, default=None, help="RSSI at d1 in dBm (e.g., -90)")

    # Choose ONE: predict RSSI at --d OR estimate distance from --rssi
    parser.add_argument("--d", type=float, default=None, help="Distance to predict RSSI at (meters)")
    parser.add_argument("--rssi", type=float, default=None, help="Measured RSSI to estimate distance from (dBm)")

    parser.add_argument("--wall_loss_db", type=float, default=0.0,
                        help="Total obstacle/wall loss in dB (default 0). Example: 8, 15, ...")

    args = parser.parse_args()

    # Interactive fallback if calibration params missing
    def ask(name: str, current):
        if current is not None:
            return current
        return float(input(f"Enter {name}: ").strip())

    d0 = ask("d0 (reference distance, m)", args.d0)
    d1 = ask("d1 (second distance, m)", args.d1)
    rssi_d0 = ask("RSSI at d0 (dBm)", args.rssi_d0)
    rssi_d1 = ask("RSSI at d1 (dBm)", args.rssi_d1)
    wall_loss_db = args.wall_loss_db

    if d0 <= 0 or d1 <= 0:
        raise ValueError("d0 and d1 must be > 0.")
    if d1 == d0:
        raise ValueError("d1 must be different from d0.")
    if args.d is None and args.rssi is None:
        raise ValueError("Provide either --d (to predict RSSI) or --rssi (to estimate distance).")
    if args.d is not None and args.rssi is not None:
        raise ValueError("Provide only one of --d or --rssi, not both.")

    # Estimate n (note: assumes your two calibration measurements are in the same condition)
    n = compute_n(d0, d1, rssi_d0, rssi_d1)

    # Convert RSSI(d0) to RSSI@1m so formulas stay consistent
    rssi_1m = rssi_at_1m_from_ref(d0, rssi_d0, n)

    print(f"Estimated path-loss exponent n: {n:.4f}")
    print(f"Equivalent RSSI@1m: {rssi_1m:.2f} dBm")
    print(f"Using wall_loss_db: {wall_loss_db:.2f} dB\n")

    if args.d is not None:
        d = args.d
        if d <= 0:
            raise ValueError("--d must be > 0.")
        rssi_est = rssi_pred(d, rssi_1m, n, wall_loss_db)
        print(f"Predicted RSSI at d={d} m: {rssi_est:.2f} dBm")
    else:
        rssi_meas = args.rssi
        d_est = dist_from_rssi(rssi_meas, rssi_1m, n, wall_loss_db)
        print(f"Estimated distance from RSSI={rssi_meas:.2f} dBm: {d_est:.2f} m")

import matplotlib.pyplot as plt
import numpy as np

# Reuse the rssi_pred function from your script
def rssi_pred(d: float, rssi_1m: float, n: float, wall_loss_db: float = 0.0) -> float:
    """Predict RSSI at distance d (meters) with optional wall loss (dB)."""
    return rssi_1m - 10.0 * n * np.log10(d) - wall_loss_db

def plot_rssi_vs_distance():
    # Parameters
    n = 2.3
    d0 = 1.0  # meters
    rssi_1m = -50.0  # dBm (assumed; adjust based on your calibration)
    wall_loss_db = 0.0  # dB
    
    # Distances: 2, 4, 6, ..., 30
    distances = list(range(2, 31, 2))
    
    # Compute RSSI for each distance
    rssi_values = [rssi_pred(d, rssi_1m, n, wall_loss_db) for d in distances]
    
    # Plot
    plt.figure(figsize=(10, 6))
    plt.plot(distances, rssi_values, marker='o', linestyle='-', color='b', label=f'n={n}, RSSI@1m={rssi_1m} dBm')
    plt.xlabel('Distance (m)')
    plt.ylabel('Predicted RSSI (dBm)')
    plt.title('RSSI vs Distance (Log-Distance Model)')
    plt.grid(True)
    plt.legend()
    plt.show()

if __name__ == "__main__":
    main()

if __name__ == "__main__":
    plot_rssi_vs_distance()