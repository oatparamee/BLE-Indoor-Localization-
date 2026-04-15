"""
==========================================================================
  BEACON CONFIGURATION — Replace with real measurements later
==========================================================================
  HOW TO CHANGE OR ADD BEACONS:
    1. Edit the BEACONS dict below — each key is the beacon name
       (must match the BLE advertised name EXACTLY as your ESP32 broadcasts it).
    2. Set x and y to the beacon's real position in meters.
    3. You can add as many beacons as you want — the math supports N >= 3.
    4. After editing here, also update the matching config in the
       React Native app at: frontend/src/config/beacons.ts

  FORMULA:  d = 10 ^ ((RSSI_D0 - RSSI) / (10 * N))
    - RSSI_D0: reference RSSI at 1 meter (single global value, not per-beacon)
    - N: path loss exponent (single global value)
    - Change both here AND in frontend/src/config/beacons.ts to keep in sync.
==========================================================================
"""

# Replace with real measurements later
BEACONS = {
    "Beacon_A": {"x": 0, "y": 0},
    "Beacon_B": {"x": 6, "y": 0},
    "Beacon_C": {"x": 3, "y": 5},
}

# Reference RSSI at d0 = 1 meter — replace with real measurements later
RSSI_D0 = -63

# Path loss exponent — replace with real measurements later
N = 2.0
