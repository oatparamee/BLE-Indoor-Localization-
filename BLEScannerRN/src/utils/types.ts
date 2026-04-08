/**
 * Type definitions for the BLE Scanner app.
 */

/** Signal strength category for color-coding the UI. */
export type SignalStrength = 'strong' | 'medium' | 'weak';

/**
 * Represents a single discovered BLE peripheral.
 * Holds both raw and Kalman-filtered RSSI values.
 */
export interface BLEDeviceInfo {
  /** Unique device identifier from the BLE stack. */
  id: string;

  /** Advertised device name, or "Unknown" if not broadcast. */
  name: string;

  /** Most recent raw RSSI value (in dBm). */
  rssi: number;

  /** Kalman-filtered RSSI value for smoother display. */
  filteredRssi: number;

  /** Timestamp (ms) of when this device was last seen. */
  lastSeen: number;
}

/**
 * Returns the signal strength category based on RSSI.
 *   - strong:  RSSI > -60
 *   - medium:  RSSI between -60 and -80
 *   - weak:    RSSI < -80
 */
export function getSignalStrength(rssi: number): SignalStrength {
  if (rssi > -60) return 'strong';
  if (rssi >= -80) return 'medium';
  return 'weak';
}

/**
 * Returns the number of signal bars (1–4) to display,
 * similar to a Wi-Fi strength icon.
 */
export function getSignalBars(rssi: number): number {
  if (rssi > -50) return 4;
  if (rssi > -60) return 3;
  if (rssi > -70) return 2;
  return 1;
}

/**
 * Maps a signal strength category to its display color.
 */
export function getSignalColor(strength: SignalStrength): string {
  switch (strength) {
    case 'strong':
      return '#34C759'; // Green
    case 'medium':
      return '#FFCC00'; // Yellow
    case 'weak':
      return '#FF3B30'; // Red
  }
}
