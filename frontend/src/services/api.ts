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

  // ── Fingerprint live pipeline (raw RSSI -> match -> 4D KF) ────────

  /** Start the fingerprint pipeline. Optionally re-seed R from LOO cross-val. */
  fpStart: (opts?: {sigma_a?: number; seed_r_from_loo?: boolean}) =>
    post('/fp/start', {
      sigma_a: opts?.sigma_a,
      seed_r_from_loo: opts?.seed_r_from_loo ?? true,
    }),

  /** Stream raw RSSI events into the fingerprint pipeline. */
  fpRssiEvents: (events: RssiEvent[]) =>
    post('/fp/rssi/events', {events}),

  /** Latest match + 4D KF output. */
  fpPositionLatest: () => get('/fp/position/latest'),

  /** Reset the live pipeline (clear cached RSSI + KF state). */
  fpReset: () => post('/fp/reset', {}),

  /** Diagnostic snapshot of the live pipeline (sigma_a, R, r_source, etc.). */
  fpStatus: () => get('/fp/status'),

  /** Live-tune sigma_a (Q) and/or R (2x2). */
  fpParams: (params: {sigma_a?: number; R?: number[][]}) =>
    post('/fp/params', params),

  /** Run LOO cross-val WITHOUT applying the result. For inspection. */
  fpREstimate: () => get('/fp/r/estimate'),

  /** Fetch the walkable polyline used by the live pipeline. */
  fpPathGet: () =>
    get('/fp/path') as Promise<{
      segments: {x1: number; y1: number; x2: number; y2: number}[];
    }>,

  /** Replace the walkable polyline. Pass empty list to disable. */
  fpPathSet: (
    segments: {x1: number; y1: number; x2: number; y2: number}[],
  ) => post('/fp/path', {segments}),
};
