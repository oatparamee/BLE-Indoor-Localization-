/**
 * ==========================================================================
 *   BEACON CONFIGURATION — Replace with real measurements later
 * ==========================================================================
 *   HOW TO CHANGE OR ADD BEACONS:
 *     1. Edit the BEACONS object below — each key is the beacon name
 *        (must match the BLE advertised name EXACTLY as your ESP32 broadcasts it).
 *     2. Set x and y to the beacon's real position in meters.
 *     3. You can add as many beacons as you want — the system auto-detects
 *        any BLE device whose name matches a key in this object.
 *     4. After editing here, also update the matching config in the
 *        Flask backend at: backend/config.py
 *
 *   FORMULA:  d = 10 ^ ((RSSI_D0 - RSSI) / (10 * N))
 *     - RSSI_D0: reference RSSI at 1 meter (single global value, not per-beacon)
 *     - N: path loss exponent (single global value)
 *     - Change both below AND in backend/config.py to keep them in sync.
 * ==========================================================================
 */

export interface BeaconConfig {
  x: number;
  y: number;
}

// Replace with real measurements later
export const BEACONS: Record<string, BeaconConfig> = {
  Beacon_A: {x: 0, y: 0},
  Beacon_B: {x: 6, y: 0},
  Beacon_C: {x: 3, y: 5},
};

// Reference RSSI at d0 = 1 meter — replace with real measurements later
export const RSSI_D0 = -63;

// Path loss exponent — replace with real measurements later
export const N = 2.3;

export const BEACON_NAMES = Object.keys(BEACONS);

// Rolling average window size
export const RSSI_BUFFER_SIZE = 5;

// Beacon lost timeout in milliseconds
export const BEACON_LOST_TIMEOUT_MS = 5000;