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

function withSession(path: string, sessionId?: string) {
  if (!sessionId) {
    return path;
  }
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}session_id=${encodeURIComponent(sessionId)}`;
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
  /** Optional per-beacon 1D Kalman process noise. Backend falls back to
   *  the pipeline's global default when omitted. */
  q?: number;
  /** Optional per-beacon 1D Kalman measurement noise. Same rules as q. */
  r?: number;
}

export interface RssiEvent {
  beacon_id: string;
  beacon_name?: string;
  rssi: number;
}

export interface PersistedBeacon {
  id: string;
  name: string;
  x: number;
  y: number;
  q?: number;
  r?: number;
}

export const api = {
  health: () => get('/health'),

  // ── Beacons (persistent registry on the backend) ──────────────────

  /** Fetch all configured beacons as {beacon_id: PersistedBeacon}. */
  beaconsList: () =>
    get('/beacons') as Promise<{beacons: Record<string, PersistedBeacon>}>,

  /** Add or update one beacon. Persisted to backend/data/beacons.json. */
  beaconsUpsert: (b: PersistedBeacon) => post('/beacons', b),

  /** Remove one beacon by id. */
  beaconsDelete: (id: string) =>
    fetch(`${getApiUrl()}/beacons/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then(parseJsonResponse),

  /** Wipe the entire beacon registry. */
  beaconsClear: () => post('/beacons/clear', {}),

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

  /** Live-tune one beacon's 1D Kalman q/r without re-running /pipeline/setup. */
  pipelineBeaconKalman: (beacon_id: string, q: number | null, r: number | null) =>
    post('/pipeline/beacon/kalman', {beacon_id, q, r}),

  // ── Site survey (fingerprint grid collection) ────────────────────

  /** Begin collecting raw RSSI for one grid cell for this phone/session. */
  surveyStart: (
    x: number,
    y: number,
    samples_target: number,
    session_id?: string,
  ) => post('/survey/start', {x, y, samples_target, session_id}),

  /** Append raw RSSI events to this phone/session's active survey cell. */
  surveyEvents: (events: RssiEvent[], session_id?: string) =>
    post('/survey/events', {events, session_id}),

  /** Per-beacon sample counts vs target for this phone/session. */
  surveyProgress: (session_id?: string) => get(withSession('/survey/progress', session_id)),

  /** Save the active cell to the fingerprint store and end the session.
   *  Pass expected_beacons so beacons that were silent get stored as null. */
  surveyFinalize: (expected_beacons?: string[], session_id?: string) =>
    post(
      '/survey/finalize',
      expected_beacons ? {expected_beacons, session_id} : {session_id},
    ),

  /** Discard this phone/session's active survey session without saving. */
  surveyCancel: (session_id?: string) => post('/survey/cancel', {session_id}),

  // ── Fingerprint store / matcher ──────────────────────────────────

  /** All surveyed cells + global summary (cell count, floor, beacons). */
  fingerprintCells: () => get('/fingerprint/cells'),

  /** Global summary only — cheap, safe to poll. */
  fingerprintSummary: () => get('/fingerprint/summary'),

  /** Delete one cell from the fingerprint. */
  fingerprintDeleteCell: (x: number, y: number) =>
    fetch(`${getApiUrl()}/fingerprint/cells/${x}/${y}`, {method: 'DELETE'}).then(
      parseJsonResponse,
    ),

  /** Wipe the entire fingerprint. */
  fingerprintClear: () => post('/fingerprint/clear', {}),

  /** Estimate position from a current RSSI vector via Gaussian fingerprint match. */
  fingerprintMatch: (
    rssi: Record<string, number | null>,
    top_k = 4,
  ) => post('/fingerprint/match', {rssi, top_k}),
};
