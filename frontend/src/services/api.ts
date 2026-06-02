import {getApiMode, getApiUrl} from '../config/api';
import {localBackendApi} from './localBackend';

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
  /** Optional hardware identifiers parsed from the iBeacon
   *  advertisement. The backend uses these (when present) to
   *  canonicalise to a configured beacon, even if the device.id /
   *  advertised name don't match the registry. */
  ibeacon_uuid?: string | null;
  ibeacon_major?: number | null;
  ibeacon_minor?: number | null;
}

export interface PersistedBeacon {
  id: string;
  name: string;
  x: number;
  y: number;
  q?: number;
  r?: number;
  /** Apple iBeacon proximity UUID (configured in KBeaconPro). */
  uuid?: string;
  /** iBeacon Major (0-65535). */
  major?: number;
  /** iBeacon Minor (0-65535). */
  minor?: number;
  /** Alternate advertised names this physical beacon is known to
   *  broadcast. iOS reports a beacon's name inconsistently across
   *  phones, so a beacon can legitimately appear under several names —
   *  each alias resolves to this same beacon. */
  aliases?: string[];
}

export interface RoutePoint {
  id?: string;
  name?: string;
  x: number;
  y: number;
}

const remoteApi = {
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
  fpStart: (
    opts?: {sigma_a?: number; seed_r_from_loo?: boolean},
    session_id?: string,
  ) =>
    post('/fp/start', {
      sigma_a: opts?.sigma_a,
      seed_r_from_loo: opts?.seed_r_from_loo ?? true,
      session_id,
    }),

  /** Stream raw RSSI events into the fingerprint pipeline. */
  fpRssiEvents: (events: RssiEvent[], session_id?: string) =>
    post('/fp/rssi/events', {events, session_id}),

  /** Latest match + 4D KF output. */
  fpPositionLatest: (session_id?: string) =>
    get(withSession('/fp/position/latest', session_id)),

  /** Reset the live pipeline (clear cached RSSI + KF state). */
  fpReset: (session_id?: string) => post('/fp/reset', {session_id}),

  /** Diagnostic snapshot of the live pipeline (sigma_a, R, r_source, etc.). */
  fpStatus: (session_id?: string) => get(withSession('/fp/status', session_id)),

  /** Classify an RSSI vector as 6F vs 8F by scoring it against each
   *  floor's fingerprint and picking the closer match. rssi keys may
   *  be canonical ids, primary names, or aliases — the backend resolves
   *  them through each floor's BeaconStore. */
  floorDetect: (rssi: Record<string, number | null>) =>
    post('/floor/detect', {rssi}) as Promise<{
      floor: 6 | 8 | null;
      on_8f: boolean;
      score_6f: {per_beacon_sq_dist: number; n_beacons: number; overlap: number} | null;
      score_8f: {per_beacon_sq_dist: number; n_beacons: number; overlap: number} | null;
      reason?: string;
    }>,

  /** Live-tune sigma_a (Q) and/or R (2x2). */
  fpParams: (params: {sigma_a?: number; R?: number[][]}, session_id?: string) =>
    post('/fp/params', {...params, session_id}),

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

  /** Shortest walking route between two registered beacons, following
   *  the walkable-path polyline. */
  fpRoute: (start_beacon_id: string, end_beacon_id: string) =>
    post('/fp/route', {start_beacon_id, end_beacon_id}) as Promise<{
      start: {id: string; name: string; x: number; y: number};
      end: {id: string; name: string; x: number; y: number};
      waypoints: {x: number; y: number}[];
      length: number;
      reachable: boolean;
      reason?: string;
    }>,

  /** Shortest walking route between arbitrary points in the beacon/fingerprint
   *  meter coordinate frame. */
  fpRoutePoints: (start: RoutePoint, end: RoutePoint) =>
    post('/fp/route/points', {start, end}) as Promise<{
      start: {id: string; name: string; x: number; y: number};
      end: {id: string; name: string; x: number; y: number};
      waypoints: {x: number; y: number}[];
      length: number;
      reachable: boolean;
      reason?: string;
    }>,
};

export const api = new Proxy(remoteApi, {
  get(target, prop) {
    const backend =
      getApiMode() === 'local'
        ? (localBackendApi as unknown as typeof remoteApi)
        : target;
    return backend[prop as keyof typeof remoteApi];
  },
}) as typeof remoteApi;
