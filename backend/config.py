"""
==========================================================================
  BEACON CONFIGURATION — Replace with real measurements later
==========================================================================
  HOW TO CHANGE OR ADD BEACONS:
    1. Edit the BEACONS dict below — each key is the beacon name
       (must match the BLE advertised name exactly).
    2. Set txPower to the RSSI measured at 1 meter from that beacon.
    3. Set x and y to the beacon's real position in meters.
    4. You can add as many beacons as you want — the math supports N >= 3.
    5. After editing here, also update the matching config in the
       React Native app at: frontend/src/config/beacons.js

  HOW TO CHANGE THE PATH LOSS EXPONENT (N):
    - N depends on your environment (walls, furniture, etc.)
    - Measure it by comparing known distances to RSSI readings
    - Typical range: 2.0 (open air) to 4.0 (heavy walls)
==========================================================================
"""

# Replace with real measurements later
BEACONS = {
    "Beacon_A": {"txPower": -59, "x": 0, "y": 0},
    "Beacon_B": {"txPower": -59, "x": 6, "y": 0},
    "Beacon_C": {"txPower": -59, "x": 3, "y": 5},
}

# Path loss exponent — replace with real measurements later
N = 2.7

# Path loss exponent used for RSSI-to-distance conversion
N_DISTANCE = 1.2298
