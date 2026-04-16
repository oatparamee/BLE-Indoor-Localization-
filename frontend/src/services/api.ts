import {getApiUrl} from '../config/api';

async function post(path: string, body: object) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${getApiUrl()}${path}`, {method: 'GET'});
  return res.json();
}

export interface PositionBeaconInput {
  /** UUID / device.id of the selected BLE beacon. */
  id: string;
  /** Display name (optional, sent for logging / server echo). */
  name?: string;
  x: number;
  y: number;
  rssi: number;
}

export const api = {
  health: () => get('/health'),

  calibrateSample: (rssi: number, distance: number) =>
    post('/calibrate/sample', {rssi, distance}),

  calibrateAnalyze: () => get('/calibrate/analyze'),

  calibrateReset: () => post('/calibrate/reset', {}),

  kalmanInitialize: (Q: number, R: number) =>
    post('/kalman/initialize', {Q, R}),

  kalmanUpdate: (params: {Q?: number; R?: number}) =>
    post('/kalman/update', params),

  kalmanStatus: () => get('/kalman/status'),

  kalmanReset: () => post('/kalman/reset', {}),

  /**
   * Legacy payload: `{Beacon_A: -65, Beacon_B: -70, ...}`.
   * Backend resolves positions from its own BEACONS config by name.
   */
  position: (rssiMap: Record<string, number>) => post('/position', rssiMap),

  /**
   * New payload: caller supplies beacon ids + positions directly, so the
   * app can use ANY three detected BLE beacons for trilateration regardless
   * of what the backend has hard-coded in config.py.
   */
  positionWithBeacons: (beacons: PositionBeaconInput[]) =>
    post('/position', {beacons}),
};
