/**
 * ==========================================================================
 *   DISTANCE CALCULATION — RSSI to meters via path loss model
 * ==========================================================================
 *   Formula: d = 10 ^ ((RSSI_D0 - RSSI) / (10 * N))
 *
 *   RSSI_D0 and N are global constants (not per-beacon).
 *   Update them in: frontend/src/config/beacons.ts
 *   And also in:    backend/config.py
 * ==========================================================================
 */

import {RSSI_D0, N} from '../config/beacons';

/**
 * Convert RSSI to distance in meters.
 * Clamps minimum distance to 0.1 meters.
 */
export function rssiToDistance(rssi: number): number {
  const exponent = (RSSI_D0 - rssi) / (10.0 * N);
  const distance = Math.pow(10, exponent);
  return Math.max(distance, 0.1);
}
