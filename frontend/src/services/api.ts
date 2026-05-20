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

  // ── Live tracking pipeline (raw RSSI -> trilateration -> 4D KF) ───

  /** Begin a tracking session. Optionally set sigma_a / smoothing. */
  fpStart: (opts?: {sigma_a?: number; smoothing_window?: number}) =>
    post('/fp/start', {
      sigma_a: opts?.sigma_a,
      smoothing_window: opts?.smoothing_window,
    }),

  /** Stream raw RSSI events into the tracking pipeline. */
  fpRssiEvents: (events: RssiEvent[]) =>
    post('/fp/rssi/events', {events}),

  /** Latest trilaterated + 4D KF position. */
  fpPositionLatest: () => get('/fp/position/latest'),

  /** Reset the pipeline (clear cached RSSI + KF state). */
  fpReset: () => post('/fp/reset', {}),

  /** Diagnostic snapshot of the pipeline (sigma_a, R, smoothing, etc.). */
  fpStatus: () => get('/fp/status'),

  /** Live-tune sigma_a (Q), R (2x2), and/or the RSSI smoothing window. */
  fpParams: (params: {
    sigma_a?: number;
    R?: number[][];
    smoothing_window?: number;
  }) => post('/fp/params', params),

  /** Fetch the walkable polyline used by the pipeline. */
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
};
