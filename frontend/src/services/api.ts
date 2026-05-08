import {getApiUrl} from '../config/api';

async function parseJsonResponse(res: Response) {
  const text = await res.text();

  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(
      `HTTP ${res.status} ${res.statusText}: expected JSON, got ${snippet || 'empty response'}`,
    );
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.message ||
      `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return data;
}

async function post(path: string, body: object) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  return parseJsonResponse(res);
}

async function get(path: string) {
  const res = await fetch(`${getApiUrl()}${path}`, {method: 'GET'});
  return parseJsonResponse(res);
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

export interface PipelineBeaconSetup {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface RssiEvent {
  beacon_id: string;
  rssi: number;
}

export const api = {
  health: () => get('/health'),

  calibrateSample: (rssi: number, distance: number) =>
    post('/calibrate/sample', {rssi, distance}),

  calibrateAnalyze: () => get('/calibrate/analyze'),

  calibrateReset: (maxSamples?: number) =>
    post(
      '/calibrate/reset',
      maxSamples !== undefined ? {max_samples: maxSamples} : {},
    ),

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

  // ── Two-stage pipeline (per-beacon RSSI KF + position KF) ────────

  /** Register beacons for a tracking session. Replaces any prior setup. */
  pipelineSetup: (
    beacons: PipelineBeaconSetup[],
    options?: {resetPositionFilter?: boolean},
  ) =>
    post('/pipeline/setup', {
      beacons,
      reset_position_filter: options?.resetPositionFilter ?? true,
    }),

  /** Stream a batch of raw RSSI events into the per-beacon KFs. */
  pipelineRssiEvents: (events: RssiEvent[]) =>
    post('/rssi/events', {events}),

  /** Compute and return the current smoothed position. */
  pipelineLatestPosition: () => get('/position/latest'),

  /** Reset all per-beacon filters and the position Kalman filter. */
  pipelineReset: () => post('/pipeline/reset', {}),

  /** Diagnostic snapshot of the pipeline state. */
  pipelineStatus: () => get('/pipeline/status'),

  /** Live-tune Q and/or R on the pipeline's position Kalman filter. */
  pipelineKalmanUpdate: (params: {Q?: number; R?: number}) =>
    post('/pipeline/kalman/update', params),
};
