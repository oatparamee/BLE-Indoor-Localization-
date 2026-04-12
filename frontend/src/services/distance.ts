/**
 * ==========================================================================
 *   DISTANCE CALCULATION — RSSI to meters via path loss model
 * ==========================================================================
 *   Beacon txPower and N values come from the config.
 *   Update them in: frontend/src/config/beacons.ts
 *   And also in:    backend/config.py
 * ==========================================================================
 */

import {BEACONS, N_DISTANCE} from '../config/beacons';

/**
 * Convert RSSI to distance in meters using the log-distance path loss model:
 *   distance = 10 ^ ((txPower - rssi) / (10 * n))
 * Clamps minimum distance to 0.1 meters.
 */
export function rssiToDistance(
  rssi: number,
  txPower: number,
  n: number = N_DISTANCE,
): number {
  const exponent = (txPower - rssi) / (10.0 * n);
  const distance = Math.pow(10, exponent);
  return Math.max(distance, 0.1);
}

/**
 * Calculate distances for all beacons given a map of smoothed RSSI values.
 * Returns a map of beacon name -> distance in meters.
 */
export function calculateDistances(
  rssiMap: Record<string, number | null>,
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [name, rssi] of Object.entries(rssiMap)) {
    if (rssi === null || !(name in BEACONS)) {
      result[name] = null;
      continue;
    }
    const beacon = BEACONS[name];
    result[name] = rssiToDistance(rssi, beacon.txPower);
  }
  return result;
}
