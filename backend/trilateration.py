"""
Trilateration using least-squares linearization.

Formula: d = 10 ^ ((RSSI_D0 - RSSI) / (10 * N))

Supports 3 or more beacons. With exactly 3 beacons the system is
fully determined; with more it is over-determined and numpy.linalg.lstsq
finds the best fit.
"""

import numpy as np
from config import BEACONS, RSSI_D0, N


def rssi_to_distance(rssi):
    """Convert RSSI to distance in meters.
    d = 10 ^ ((RSSI_D0 - RSSI) / (10 * N))
    Clamp minimum to 0.1 m.
    """
    exponent = (RSSI_D0 - rssi) / (10.0 * N)
    distance = 10.0 ** exponent
    return max(distance, 0.1)


def trilaterate(rssi_readings: dict):
    """
    rssi_readings: { "Beacon_A": -65, "Beacon_B": -72, ... }
    Returns (distances_dict, raw_x, raw_y) or raises ValueError.
    """
    beacon_names = [name for name in rssi_readings if name in BEACONS]
    if len(beacon_names) < 3:
        raise ValueError(
            f"Need at least 3 known beacons, got {len(beacon_names)}: {beacon_names}"
        )

    positions = []
    distances = []
    distances_dict = {}

    for name in beacon_names:
        b = BEACONS[name]
        rssi = rssi_readings[name]
        d = rssi_to_distance(rssi)
        positions.append([b["x"], b["y"]])
        distances.append(d)
        distances_dict[name] = round(d, 4)

    positions = np.array(positions, dtype=float)
    distances = np.array(distances, dtype=float)

    n = len(positions)
    ref = n - 1
    x_ref, y_ref = positions[ref]
    d_ref = distances[ref]

    A = []
    b_vec = []
    for i in range(ref):
        xi, yi = positions[i]
        di = distances[i]
        A.append([2.0 * (x_ref - xi), 2.0 * (y_ref - yi)])
        b_vec.append(
            di**2 - d_ref**2
            - xi**2 + x_ref**2
            - yi**2 + y_ref**2
        )

    A = np.array(A)
    b_vec = np.array(b_vec)

    try:
        result, residuals, rank, sv = np.linalg.lstsq(A, b_vec, rcond=None)
    except np.linalg.LinAlgError:
        raise ValueError("Trilateration failed — singular matrix (beacons may be collinear)")

    if rank < 2:
        raise ValueError("Trilateration failed — beacons are collinear or overlapping")

    raw_x = float(result[0])
    raw_y = float(result[1])

    return distances_dict, raw_x, raw_y
