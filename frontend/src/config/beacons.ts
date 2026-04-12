/**
 * ==========================================================================
 *   BEACON CONFIGURATION — Replace with real measurements later
 * ==========================================================================
 *   HOW TO CHANGE OR ADD BEACONS:
 *     1. Edit the BEACONS object below — each key is the beacon name
 *        (must match the BLE advertised name exactly).
 *     2. Set txPower to the RSSI measured at 1 meter from that beacon.
 *     3. Set x and y to the beacon's real position in meters.
 *     4. You can add as many beacons as you want.
 *     5. After editing here, also update the matching config in the
 *        Flask backend at: backend/config.py
 *
 *   HOW TO CHANGE THE PATH LOSS EXPONENT (N):
 *     - N depends on your environment (walls, furniture, etc.)
 *     - Typical range: 2.0 (open air) to 4.0 (heavy walls)
 * ==========================================================================
 */

export interface BeaconConfig {
  txPower: number;
  x: number;
  y: number;
}

// Replace with real measurements later
export const BEACONS: Record<string, BeaconConfig> = {
  Beacon_A: {txPower: -59, x: 0, y: 0},
  Beacon_B: {txPower: -59, x: 6, y: 0},
  Beacon_C: {txPower: -59, x: 3, y: 5},
};

// Path loss exponent — replace with real measurements later
export const N = 2.7;

// Path loss exponent used for RSSI-to-distance conversion
export const N_DISTANCE = 1.2298;

export const BEACON_NAMES = Object.keys(BEACONS);

// Rolling average window size
export const RSSI_BUFFER_SIZE = 5;

// Beacon lost timeout in milliseconds
export const BEACON_LOST_TIMEOUT_MS = 5000;
