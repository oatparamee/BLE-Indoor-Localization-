import AsyncStorage from '@react-native-async-storage/async-storage';
import type {PersistedBeacon, RssiEvent, RoutePoint} from './api';

declare const require: (path: string) => unknown;

type BeaconMap = Record<string, PersistedBeacon>;

interface BeaconBlob {
  schema_version?: number;
  beacons: BeaconMap;
}

interface CellBeaconStats {
  n: number;
  mean: number;
  var: number;
  std: number;
  min: number;
  max: number;
  samples?: number[];
}

interface FingerprintCell {
  x: number;
  y: number;
  timestamp?: number;
  beacons: Record<string, CellBeaconStats | null>;
}

interface FingerprintBlob {
  schema_version?: number;
  grid_step_m?: number;
  cells: Record<string, FingerprintCell>;
}

interface PathSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PathBlob {
  schema_version?: number;
  segments: PathSegment[];
}

interface SurveySession {
  sessionId: string;
  x: number;
  y: number;
  samplesTarget: number;
  startedAt: number;
  buffer: Record<string, number[]>;
}

interface MatchResult {
  x: number;
  y: number;
  top: Array<{
    x: number;
    y: number;
    sq_dist: number;
    distance: number;
    weight: number;
    n_beacons: number;
  }>;
  floor_rssi: number;
}

interface LocalState {
  beacons: BeaconMap;
  fingerprint: FingerprintBlob;
  beacons8f: BeaconMap;
  fingerprint8f: FingerprintBlob;
  path: PathSegment[];
}

const seedBeacons = require('../data/backendSeed/beacons.json') as BeaconBlob;
const seedFingerprint = require('../data/backendSeed/fingerprint.json') as FingerprintBlob;
const seedBeacons8f = require('../data/backendSeed/beacons_8f.json') as BeaconBlob;
const seedFingerprint8f = require('../data/backendSeed/fingerprint_8f.json') as FingerprintBlob;
const seedPath = require('../data/backendSeed/path.json') as PathBlob;

const STORAGE_BEACONS = '@ble_local_backend_beacons_v1';
const STORAGE_FINGERPRINT = '@ble_local_backend_fingerprint_v1';
const STORAGE_PATH = '@ble_local_backend_path_v1';

const TOP_K_DEFAULT = 4;
const MIN_SAMPLES_DEFAULT = 10;
const DISTANCE_EPSILON = 1e-6;
const FLOOR_MARGIN_DB = 0;
const DEFAULT_SIGMA_A = 0.5;
const DT_MIN = 1e-3;
const DT_MAX = 5;
const NODE_MERGE_TOL = 0.1;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const nowSeconds = () => Date.now() / 1000;
const uint16 = (value: number) => {
  const truncated = Math.trunc(value);
  return ((truncated % 65536) + 65536) % 65536;
};

let state: LocalState = {
  beacons: {},
  fingerprint: {schema_version: 1, grid_step_m: 1, cells: {}},
  beacons8f: {},
  fingerprint8f: {schema_version: 1, grid_step_m: 1, cells: {}},
  path: [],
};
let loaded = false;
let loadPromise: Promise<void> | null = null;

const surveySessions = new Map<string, SurveySession>();
const fpPipelines = new Map<string, FingerprintPipeline>();

function normalizeBeacon(beacon: PersistedBeacon): PersistedBeacon {
  const out: PersistedBeacon = {
    id: String(beacon.id),
    name: String(beacon.name || beacon.id),
    x: Number(beacon.x),
    y: Number(beacon.y),
  };
  if (typeof beacon.q === 'number' && Number.isFinite(beacon.q)) {
    out.q = beacon.q;
  }
  if (typeof beacon.r === 'number' && Number.isFinite(beacon.r)) {
    out.r = beacon.r;
  }
  if (typeof beacon.uuid === 'string' && beacon.uuid.trim()) {
    out.uuid = beacon.uuid.trim().toUpperCase();
  }
  if (typeof beacon.major === 'number' && Number.isFinite(beacon.major)) {
    out.major = uint16(beacon.major);
  }
  if (typeof beacon.minor === 'number' && Number.isFinite(beacon.minor)) {
    out.minor = uint16(beacon.minor);
  }
  if (Array.isArray(beacon.aliases)) {
    const primary = out.name.trim().toLowerCase();
    const seen = new Set<string>();
    const aliases = beacon.aliases
      .map(alias => String(alias).trim())
      .filter(alias => {
        const low = alias.toLowerCase();
        if (!alias || low === primary || seen.has(low)) {
          return false;
        }
        seen.add(low);
        return true;
      });
    if (aliases.length > 0) {
      out.aliases = aliases;
    }
  }
  return out;
}

function normalizeBeaconMap(input: BeaconMap | undefined): BeaconMap {
  const out: BeaconMap = {};
  for (const [id, beacon] of Object.entries(input ?? {})) {
    const normalized = normalizeBeacon({...beacon, id: beacon.id ?? id});
    out[normalized.id] = normalized;
  }
  return out;
}

function normalizeFingerprintBlob(input: FingerprintBlob | undefined): FingerprintBlob {
  return {
    schema_version: input?.schema_version ?? 1,
    grid_step_m: Number(input?.grid_step_m ?? 1),
    cells: clone(input?.cells ?? {}),
  };
}

function parseStored<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return clone(fallback);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return clone(fallback);
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    const fallbackBeacons = {
      schema_version: 1,
      beacons: normalizeBeaconMap(seedBeacons.beacons),
    };
    const fallbackFingerprint = normalizeFingerprintBlob(seedFingerprint);
    const fallbackPath = clone(seedPath.segments ?? []);

    const entries = await AsyncStorage.multiGet([
      STORAGE_BEACONS,
      STORAGE_FINGERPRINT,
      STORAGE_PATH,
    ]);
    const stored = Object.fromEntries(entries);
    const beaconsBlob = parseStored<BeaconBlob>(
      stored[STORAGE_BEACONS] ?? null,
      fallbackBeacons,
    );
    const fingerprintBlob = parseStored<FingerprintBlob>(
      stored[STORAGE_FINGERPRINT] ?? null,
      fallbackFingerprint,
    );
    const pathBlob = parseStored<PathBlob>(
      stored[STORAGE_PATH] ?? null,
      {schema_version: 1, segments: fallbackPath},
    );

    state = {
      beacons: normalizeBeaconMap(beaconsBlob.beacons),
      fingerprint: normalizeFingerprintBlob(fingerprintBlob),
      beacons8f: normalizeBeaconMap(seedBeacons8f.beacons),
      fingerprint8f: normalizeFingerprintBlob(seedFingerprint8f),
      path: coerceSegments(pathBlob.segments),
    };
    loaded = true;
  })();
  return loadPromise;
}

const saveBeacons = () =>
  AsyncStorage.setItem(
    STORAGE_BEACONS,
    JSON.stringify({schema_version: 1, beacons: state.beacons}),
  );

const saveFingerprint = () =>
  AsyncStorage.setItem(STORAGE_FINGERPRINT, JSON.stringify(state.fingerprint));

const savePath = () =>
  AsyncStorage.setItem(
    STORAGE_PATH,
    JSON.stringify({schema_version: 1, segments: state.path}),
  );

function sessionId(value?: string) {
  return String(value || 'default');
}

function cellKey(x: number, y: number) {
  return `${Number(x)},${Number(y)}`;
}

function cellStats(samples: number[]): CellBeaconStats {
  const n = samples.length;
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / n;
  const variance =
    samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / n;
  return {
    n,
    mean: round(mean),
    var: round(variance),
    std: round(Math.sqrt(variance)),
    min: round(Math.min(...samples)),
    max: round(Math.max(...samples)),
    samples: samples.map(sample => round(sample)),
  };
}

function entrySamples(entry: CellBeaconStats | null | undefined): number[] {
  if (!entry || !Array.isArray(entry.samples)) {
    return [];
  }
  return entry.samples
    .map(sample => Number(sample))
    .filter(sample => Number.isFinite(sample));
}

function listCells(blob = state.fingerprint): FingerprintCell[] {
  return Object.values(blob.cells ?? {}).map(cell => clone(cell));
}

function knownBeacons(blob = state.fingerprint): Set<string> {
  const ids = new Set<string>();
  for (const cell of Object.values(blob.cells ?? {})) {
    for (const id of Object.keys(cell.beacons ?? {})) {
      ids.add(id);
    }
  }
  return ids;
}

function floorRssi(blob = state.fingerprint): number | null {
  const values: number[] = [];
  for (const cell of Object.values(blob.cells ?? {})) {
    for (const entry of Object.values(cell.beacons ?? {})) {
      if (entry && typeof entry.min === 'number') {
        values.push(entry.min);
      }
    }
  }
  if (values.length === 0) {
    return null;
  }
  return Math.min(...values) - FLOOR_MARGIN_DB;
}

function fingerprintSummary(blob = state.fingerprint) {
  const cells = Object.values(blob.cells ?? {});
  const beaconIds = new Set<string>();
  let withData = 0;
  let missing = 0;
  for (const cell of cells) {
    for (const [id, entry] of Object.entries(cell.beacons ?? {})) {
      beaconIds.add(id);
      if (entry) {
        withData += 1;
      } else {
        missing += 1;
      }
    }
  }
  return {
    cell_count: cells.length,
    beacons: [...beaconIds].sort(),
    grid_step_m: Number(blob.grid_step_m ?? 1),
    floor_rssi: floorRssi(blob),
    cells_x_beacons_with_data: withData,
    cells_x_beacons_missing: missing,
  };
}

function upsertCell(
  x: number,
  y: number,
  perBeaconSamples: Record<string, number[]>,
): FingerprintCell {
  const key = cellKey(x, y);
  const existing = state.fingerprint.cells[key];
  const existingBeacons = existing?.beacons ?? {};
  const beaconIds = new Set<string>([
    ...Object.keys(existingBeacons),
    ...Object.keys(perBeaconSamples).map(String),
  ]);
  const cell: FingerprintCell = {
    x: Number(x),
    y: Number(y),
    timestamp: nowSeconds(),
    beacons: {},
  };
  for (const id of beaconIds) {
    const samples = [
      ...entrySamples(existingBeacons[id]),
      ...(perBeaconSamples[id] ?? [])
        .map(sample => Number(sample))
        .filter(sample => Number.isFinite(sample)),
    ];
    cell.beacons[id] = samples.length > 0 ? cellStats(samples) : null;
  }
  state.fingerprint.cells[key] = cell;
  return clone(cell);
}

function snapshotSurvey(s: SurveySession) {
  const per_beacon: Record<string, {count: number; target: number}> = {};
  for (const [id, samples] of Object.entries(s.buffer)) {
    per_beacon[id] = {count: samples.length, target: s.samplesTarget};
  }
  const counts = Object.values(per_beacon).map(entry => entry.count);
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;
  const maxCount = counts.length > 0 ? Math.max(...counts) : 0;
  return {
    session_id: s.sessionId,
    x: s.x,
    y: s.y,
    samples_target: s.samplesTarget,
    started_at: s.startedAt,
    elapsed_s: round(nowSeconds() - s.startedAt, 3),
    per_beacon,
    max_count: maxCount,
    min_count: minCount,
    all_full: minCount >= s.samplesTarget && counts.length > 0,
  };
}

function buildBeaconIndexes(beacons: BeaconMap) {
  const byName = new Map<string, string>();
  const byUpperId = new Map<string, string>();
  const byIBeacon = new Map<string, string>();
  for (const beacon of Object.values(beacons)) {
    byUpperId.set(beacon.id.toUpperCase(), beacon.id);
    if (beacon.name) {
      byName.set(beacon.name.trim().toLowerCase(), beacon.id);
    }
    for (const alias of beacon.aliases ?? []) {
      const clean = alias.trim().toLowerCase();
      if (clean) {
        byName.set(clean, beacon.id);
      }
    }
    if (
      beacon.uuid &&
      beacon.major !== undefined &&
      beacon.minor !== undefined
    ) {
      byIBeacon.set(
        `${beacon.uuid.toUpperCase()}|${uint16(beacon.major)}|${uint16(
          beacon.minor,
        )}`,
        beacon.id,
      );
    }
  }
  return {byName, byUpperId, byIBeacon};
}

function canonicalizeEvents(events: RssiEvent[]): RssiEvent[] {
  const {byName, byUpperId, byIBeacon} = buildBeaconIndexes(state.beacons);
  return events.map(event => {
    let canonicalId: string | undefined;
    if (
      event.ibeacon_uuid &&
      event.ibeacon_major !== null &&
      event.ibeacon_major !== undefined &&
      event.ibeacon_minor !== null &&
      event.ibeacon_minor !== undefined
    ) {
      canonicalId = byIBeacon.get(
        `${event.ibeacon_uuid.toUpperCase()}|${uint16(
          event.ibeacon_major,
        )}|${uint16(event.ibeacon_minor)}`,
      );
    }
    if (!canonicalId && event.beacon_name) {
      canonicalId = byName.get(event.beacon_name.trim().toLowerCase());
    }
    if (!canonicalId && event.beacon_id) {
      canonicalId = byUpperId.get(String(event.beacon_id).toUpperCase());
    }
    return canonicalId ? {...event, beacon_id: canonicalId} : event;
  });
}

function matchCells(
  cells: FingerprintCell[],
  rssiVector: Record<string, number | null>,
  floorValue: number | null,
  known: Set<string>,
  topK = TOP_K_DEFAULT,
  minSamples = MIN_SAMPLES_DEFAULT,
): MatchResult | null {
  if (cells.length === 0 || floorValue === null || known.size === 0) {
    return null;
  }
  const knownIds = [...known].sort();
  const minN = Math.max(1, Math.trunc(minSamples));
  const scored = cells.map(cell => {
    let sqDist = 0;
    for (const id of knownIds) {
      let entry = cell.beacons?.[id] ?? null;
      if (entry && Number(entry.n ?? 0) < minN) {
        entry = null;
      }
      const mu = entry ? Number(entry.mean) : floorValue;
      const z = rssiVector[id];
      const zValue = z !== null && z !== undefined ? Number(z) : floorValue;
      const diff = zValue - mu;
      sqDist += diff * diff;
    }
    return {
      x: Number(cell.x),
      y: Number(cell.y),
      sq_dist: sqDist,
      n_beacons: knownIds.length,
    };
  });

  scored.sort((a, b) => a.sq_dist - b.sq_dist);
  const top = scored.slice(0, Math.max(1, Math.trunc(topK)));
  const weights = top.map(
    cell => 1 / (Math.sqrt(cell.sq_dist) + DISTANCE_EPSILON),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    const best = top[0];
    return {
      x: best.x,
      y: best.y,
      top: [{...best, distance: Math.sqrt(best.sq_dist), weight: 1}],
      floor_rssi: floorValue,
    };
  }
  const x =
    top.reduce((sum, cell, index) => sum + cell.x * weights[index], 0) /
    totalWeight;
  const y =
    top.reduce((sum, cell, index) => sum + cell.y * weights[index], 0) /
    totalWeight;
  return {
    x: round(x),
    y: round(y),
    top: top.map((cell, index) => ({
      x: cell.x,
      y: cell.y,
      sq_dist: round(cell.sq_dist),
      distance: round(Math.sqrt(cell.sq_dist)),
      weight: round(weights[index] / totalWeight, 6),
      n_beacons: cell.n_beacons,
    })),
    floor_rssi: floorValue,
  };
}

function matchFingerprint(
  blob: FingerprintBlob,
  rssi: Record<string, number | null>,
  topK = TOP_K_DEFAULT,
) {
  return matchCells(
    listCells(blob),
    rssi,
    floorRssi(blob),
    knownBeacons(blob),
    topK,
  );
}

function estimateRloo(blob: FingerprintBlob, topK = TOP_K_DEFAULT) {
  const cells = listCells(blob);
  if (cells.length < 4) {
    return null;
  }
  const floor = floorRssi(blob);
  const known = knownBeacons(blob);
  const residuals: Array<{
    dx: number;
    dy: number;
    truth_x: number;
    truth_y: number;
    est_x: number;
    est_y: number;
  }> = [];
  for (let i = 0; i < cells.length; i += 1) {
    const held = cells[i];
    const observation: Record<string, number | null> = {};
    for (const [id, entry] of Object.entries(held.beacons ?? {})) {
      observation[id] = entry ? Number(entry.mean) : null;
    }
    const rest = [...cells.slice(0, i), ...cells.slice(i + 1)];
    const result = matchCells(rest, observation, floor, known, topK);
    if (!result) {
      continue;
    }
    residuals.push({
      dx: Number(result.x) - Number(held.x),
      dy: Number(result.y) - Number(held.y),
      truth_x: Number(held.x),
      truth_y: Number(held.y),
      est_x: Number(result.x),
      est_y: Number(result.y),
    });
  }
  if (residuals.length < 4) {
    return null;
  }
  const meanDx =
    residuals.reduce((sum, item) => sum + item.dx, 0) / residuals.length;
  const meanDy =
    residuals.reduce((sum, item) => sum + item.dy, 0) / residuals.length;
  const varXx =
    residuals.reduce((sum, item) => sum + item.dx * item.dx, 0) /
    residuals.length;
  const varYy =
    residuals.reduce((sum, item) => sum + item.dy * item.dy, 0) /
    residuals.length;
  const covXy =
    residuals.reduce((sum, item) => sum + item.dx * item.dy, 0) /
    residuals.length;
  return {
    R: [
      [varXx, covXy],
      [covXy, varYy],
    ],
    n_samples: residuals.length,
    mean_residual: {x: meanDx, y: meanDy},
    rmse: Math.sqrt(varXx + varYy),
    per_cell_residuals: residuals.map(item => ({
      truth_x: item.truth_x,
      truth_y: item.truth_y,
      est_x: item.est_x,
      est_y: item.est_y,
      dx: round(item.dx),
      dy: round(item.dy),
    })),
  };
}

type Matrix = number[][];

const identity = (size: number, scale = 1): Matrix =>
  Array.from({length: size}, (_, row) =>
    Array.from({length: size}, (__, col) => (row === col ? scale : 0)),
  );

const zeros = (rows: number, cols: number): Matrix =>
  Array.from({length: rows}, () => Array.from({length: cols}, () => 0));

const transpose = (matrix: Matrix): Matrix =>
  matrix[0].map((__, col) => matrix.map(row => row[col]));

function matrixAdd(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((value, j) => value + b[i][j]));
}

function matrixSub(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((value, j) => value - b[i][j]));
}

function matrixMul(a: Matrix, b: Matrix): Matrix {
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b[0].length; j += 1) {
      let sum = 0;
      for (let k = 0; k < b.length; k += 1) {
        sum += a[i][k] * b[k][j];
      }
      out[i][j] = sum;
    }
  }
  return out;
}

function inverse2(matrix: Matrix): Matrix | null {
  const [[a, b], [c, d]] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) <= 1e-12) {
    return null;
  }
  return [
    [d / det, -b / det],
    [-c / det, a / det],
  ];
}

class PositionKalmanFilter4D {
  sigmaA: number;
  R: Matrix;
  private x = [[0], [0], [0], [0]];
  private P = identity(4, 1000);
  private H: Matrix = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
  ];
  private lastTime: number | null = null;
  private didInit = false;

  constructor(sigmaA = DEFAULT_SIGMA_A, r?: Matrix) {
    this.sigmaA = sigmaA;
    this.R = r ?? identity(2);
  }

  setSigmaA(value: number) {
    this.sigmaA = Number(value);
  }

  setR(value: Matrix) {
    this.R = [
      [Number(value[0][0]), Number(value[0][1])],
      [Number(value[1][0]), Number(value[1][1])],
    ];
  }

  update(xMeas: number, yMeas: number, timestamp = nowSeconds()) {
    const z = [[Number(xMeas)], [Number(yMeas)]];
    const t = Number(timestamp);
    if (!this.didInit) {
      this.x = [[z[0][0]], [z[1][0]], [0], [0]];
      this.lastTime = t;
      this.didInit = true;
      return this.state();
    }

    let dt = t - (this.lastTime ?? t);
    dt = Math.max(DT_MIN, Math.min(DT_MAX, dt));
    this.lastTime = t;

    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const sa2 = this.sigmaA ** 2;
    const Q = [
      [(dt ** 4 / 4) * sa2, 0, (dt ** 3 / 2) * sa2, 0],
      [0, (dt ** 4 / 4) * sa2, 0, (dt ** 3 / 2) * sa2],
      [(dt ** 3 / 2) * sa2, 0, dt ** 2 * sa2, 0],
      [0, (dt ** 3 / 2) * sa2, 0, dt ** 2 * sa2],
    ];

    this.x = matrixMul(F, this.x);
    this.P = matrixAdd(matrixMul(matrixMul(F, this.P), transpose(F)), Q);

    const innovation = matrixSub(z, matrixMul(this.H, this.x));
    const S = matrixAdd(
      matrixMul(matrixMul(this.H, this.P), transpose(this.H)),
      this.R,
    );
    const sInv = inverse2(S);
    if (!sInv) {
      return this.state();
    }
    const K = matrixMul(matrixMul(this.P, transpose(this.H)), sInv);
    this.x = matrixAdd(this.x, matrixMul(K, innovation));
    this.P = matrixMul(matrixSub(identity(4), matrixMul(K, this.H)), this.P);
    return this.state();
  }

  state() {
    return {
      x: this.x[0][0],
      y: this.x[1][0],
      vx: this.x[2][0],
      vy: this.x[3][0],
    };
  }

  reset() {
    this.x = [[0], [0], [0], [0]];
    this.P = identity(4, 1000);
    this.lastTime = null;
    this.didInit = false;
  }

  get initialized() {
    return this.didInit;
  }

  status() {
    return {
      sigma_a: this.sigmaA,
      R: this.R,
      P: this.P,
      state: this.state(),
      initialized: this.didInit,
    };
  }
}

function coerceSegment(segment: unknown): PathSegment | null {
  try {
    if (segment && typeof segment === 'object' && !Array.isArray(segment)) {
      const s = segment as Record<string, unknown>;
      return {
        x1: Number(s.x1),
        y1: Number(s.y1),
        x2: Number(s.x2),
        y2: Number(s.y2),
      };
    }
    if (Array.isArray(segment) && segment.length === 4) {
      return {
        x1: Number(segment[0]),
        y1: Number(segment[1]),
        x2: Number(segment[2]),
        y2: Number(segment[3]),
      };
    }
    if (Array.isArray(segment) && segment.length === 2) {
      const [a, b] = segment;
      if (Array.isArray(a) && Array.isArray(b)) {
        return {
          x1: Number(a[0]),
          y1: Number(a[1]),
          x2: Number(b[0]),
          y2: Number(b[1]),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function coerceSegments(segments: unknown): PathSegment[] {
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments
    .map(coerceSegment)
    .filter((segment): segment is PathSegment => {
      if (!segment) {
        return false;
      }
      return [segment.x1, segment.y1, segment.x2, segment.y2].every(value =>
        Number.isFinite(value),
      );
    });
}

function projectPointToSegment(
  px: number,
  py: number,
  segment: PathSegment,
) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const segLen2 = dx * dx + dy * dy;
  if (segLen2 <= 1e-12) {
    return {x: segment.x1, y: segment.y1};
  }
  const t = Math.max(
    0,
    Math.min(1, ((px - segment.x1) * dx + (py - segment.y1) * dy) / segLen2),
  );
  return {
    x: segment.x1 + t * dx,
    y: segment.y1 + t * dy,
  };
}

function projectToPath(x: number, y: number) {
  if (state.path.length === 0) {
    return {x, y};
  }
  let best = {x, y};
  let bestD2 = Infinity;
  for (const segment of state.path) {
    const point = projectPointToSegment(x, y, segment);
    const d2 = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (d2 < bestD2) {
      best = point;
      bestD2 = d2;
    }
  }
  return best;
}

class FingerprintPipeline {
  private kf = new PositionKalmanFilter4D();
  private latestRssi: Record<string, number> = {};
  private lastSeen: Record<string, number> = {};
  private lastResult: Record<string, unknown> | null = null;
  private rSource = 'default';
  private lastREstimate: ReturnType<typeof estimateRloo> = null;

  constructor(
    private sigmaA = DEFAULT_SIGMA_A,
    private beaconTimeoutS = 5,
    private topK = TOP_K_DEFAULT,
  ) {
    this.kf.setSigmaA(this.sigmaA);
  }

  setParams(params: {sigmaA?: number; r?: Matrix | null}) {
    if (params.sigmaA !== undefined) {
      this.sigmaA = Number(params.sigmaA);
      this.kf.setSigmaA(this.sigmaA);
    }
    if (params.r) {
      this.kf.setR(params.r);
      this.rSource = 'manual';
    }
  }

  seedRFromLoo() {
    const estimate = estimateRloo(state.fingerprint, this.topK);
    this.lastREstimate = estimate;
    if (estimate) {
      this.kf.setR(estimate.R);
      this.rSource = 'loo_cv';
    }
    return estimate;
  }

  reset() {
    this.latestRssi = {};
    this.lastSeen = {};
    this.lastResult = null;
    this.kf.reset();
  }

  ingestEvents(events: RssiEvent[]) {
    const now = nowSeconds();
    let applied = 0;
    for (const event of events) {
      const id = event.beacon_id || (event as RssiEvent & {id?: string}).id;
      const rssi = Number(event.rssi);
      if (!id || !Number.isFinite(rssi)) {
        continue;
      }
      this.latestRssi[String(id)] = rssi;
      this.lastSeen[String(id)] = now;
      applied += 1;
    }
    return applied;
  }

  private pruneStale() {
    const cutoff = nowSeconds() - this.beaconTimeoutS;
    for (const [id, seen] of Object.entries(this.lastSeen)) {
      if (seen < cutoff) {
        delete this.lastSeen[id];
        delete this.latestRssi[id];
      }
    }
  }

  private registeredIds() {
    return new Set(Object.values(state.beacons).map(beacon => beacon.id));
  }

  updatePosition() {
    this.pruneStale();
    const active = new Set(Object.keys(this.latestRssi));
    if (active.size === 0) {
      return null;
    }
    const fpKnown = knownBeacons(state.fingerprint);
    const registered = this.registeredIds();
    const known = new Set([...fpKnown].filter(id => registered.has(id)));
    const overlap = new Set([...active].filter(id => known.has(id)));
    if (overlap.size === 0) {
      return {
        _no_overlap: true,
        active_beacons: [...active].sort(),
        registered_beacons: [...known].sort(),
      };
    }

    const observation: Record<string, number | null> = {};
    for (const id of known) {
      observation[id] = null;
    }
    for (const [id, rssi] of Object.entries(this.latestRssi)) {
      if (known.has(id)) {
        observation[id] = rssi;
      }
    }

    const result = matchCells(
      listCells(state.fingerprint),
      observation,
      floorRssi(state.fingerprint),
      known,
      this.topK,
    );
    if (!result) {
      return null;
    }
    const timestamp = nowSeconds();
    const kfState = this.kf.update(result.x, result.y, timestamp);
    const projected =
      state.path.length > 0 ? projectToPath(kfState.x, kfState.y) : null;
    const out = {
      raw_position: {x: round(result.x), y: round(result.y)},
      kf_position: {x: round(kfState.x), y: round(kfState.y)},
      smooth_position: projected
        ? {x: round(projected.x), y: round(projected.y)}
        : {x: round(kfState.x), y: round(kfState.y)},
      constrained_to_path: projected !== null,
      velocity: {vx: round(kfState.vx), vy: round(kfState.vy)},
      active_beacons: [...active].sort(),
      overlap_beacons: [...overlap].sort(),
      top_cells: result.top,
      floor_rssi: result.floor_rssi,
      timestamp,
      initialized: this.kf.initialized,
    };
    this.lastResult = out;
    return out;
  }

  status() {
    this.pruneStale();
    const fpKnown = knownBeacons(state.fingerprint);
    const registered = this.registeredIds();
    const known = new Set([...fpKnown].filter(id => registered.has(id)));
    return {
      registered_beacons: [...known].sort(),
      fingerprint_only_beacons: [...fpKnown]
        .filter(id => !known.has(id))
        .sort(),
      active_beacons: Object.keys(this.latestRssi).sort(),
      latest_rssi: {...this.latestRssi},
      sigma_a: this.kf.sigmaA,
      R: this.kf.R,
      r_source: this.rSource,
      last_r_estimate: this.lastREstimate,
      fingerprint_summary: fingerprintSummary(state.fingerprint),
      initialized: this.kf.initialized,
      last_result: this.lastResult,
      kf: this.kf.status(),
    };
  }
}

function getPipeline(id?: string) {
  const sid = sessionId(id);
  let pipeline = fpPipelines.get(sid);
  if (!pipeline) {
    pipeline = new FingerprintPipeline();
    fpPipelines.set(sid, pipeline);
  }
  return pipeline;
}

function resolveRssiForStore(
  rssiBlob: Record<string, number | null>,
  beacons: BeaconMap,
) {
  const out: Record<string, number> = {};
  const {byName, byUpperId} = buildBeaconIndexes(beacons);
  for (const [rawKey, rawValue] of Object.entries(rssiBlob ?? {})) {
    const rssi = Number(rawValue);
    if (!Number.isFinite(rssi)) {
      continue;
    }
    const key = String(rawKey);
    const beacon =
      beacons[key] ??
      beacons[byUpperId.get(key.toUpperCase()) ?? ''] ??
      beacons[byName.get(key.trim().toLowerCase()) ?? ''];
    if (!beacon) {
      continue;
    }
    const prior = out[beacon.id];
    if (prior === undefined || rssi > prior) {
      out[beacon.id] = rssi;
    }
  }
  return out;
}

function scoreFingerprint(
  blob: FingerprintBlob,
  rssi: Record<string, number>,
) {
  const cells = listCells(blob);
  const floor = floorRssi(blob);
  const known = knownBeacons(blob);
  if (cells.length === 0 || floor === null || known.size === 0) {
    return null;
  }
  const overlap = [...known].filter(id => id in rssi).length;
  if (overlap === 0) {
    return null;
  }
  const result = matchFingerprint(blob, rssi);
  const top = result?.top?.[0];
  if (!result || !top) {
    return null;
  }
  const sqDist = Number(top.sq_dist || 0);
  const nBeacons = Math.max(1, Number(top.n_beacons || known.size));
  return {
    per_beacon_sq_dist: round(sqDist / nBeacons),
    n_beacons: nBeacons,
    overlap,
  };
}

function segmentLength(a: RoutePoint, b: RoutePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function straightLine(start: RoutePoint, end: RoutePoint, reason: string) {
  return {
    waypoints: [
      {x: start.x, y: start.y},
      {x: end.x, y: end.y},
    ],
    length: round(segmentLength(start, end)),
    reachable: false,
    reason,
  };
}

function projectWithT(point: RoutePoint, segment: PathSegment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const seg2 = dx * dx + dy * dy;
  if (seg2 <= 1e-12) {
    return {x: segment.x1, y: segment.y1, t: 0};
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / seg2),
  );
  return {
    x: segment.x1 + t * dx,
    y: segment.y1 + t * dy,
    t,
  };
}

class NodeRegistry {
  private nodes: RoutePoint[] = [];

  canonical(x: number, y: number) {
    for (const node of this.nodes) {
      if (Math.hypot(node.x - x, node.y - y) <= NODE_MERGE_TOL) {
        return node;
      }
    }
    const node = {x: Number(x), y: Number(y)};
    this.nodes.push(node);
    return node;
  }
}

const nodeKey = (node: RoutePoint) => `${node.x},${node.y}`;

function computeRoute(
  segments: PathSegment[],
  start: RoutePoint,
  end: RoutePoint,
) {
  const segs = coerceSegments(segments);
  if (segs.length === 0) {
    return straightLine(start, end, 'no walkable path defined');
  }

  const snap = (point: RoutePoint) => {
    let best: {dist2: number; index: number; x: number; y: number; t: number} | null =
      null;
    segs.forEach((segment, index) => {
      const projected = projectWithT(point, segment);
      const dist2 = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
      if (!best || dist2 < best.dist2) {
        best = {dist2, index, ...projected};
      }
    });
    return best!;
  };

  const startSnap = snap(start);
  const endSnap = snap(end);
  const registry = new NodeRegistry();
  const startNode = registry.canonical(startSnap.x, startSnap.y);
  const endNode = registry.canonical(endSnap.x, endSnap.y);
  const startKey = nodeKey(startNode);
  const endKey = nodeKey(endNode);
  const coords = new Map<string, RoutePoint>([
    [startKey, startNode],
    [endKey, endNode],
  ]);
  const adjacency = new Map<string, Array<{key: string; weight: number}>>();

  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const a = registry.canonical(ax, ay);
    const b = registry.canonical(bx, by);
    const ak = nodeKey(a);
    const bk = nodeKey(b);
    coords.set(ak, a);
    coords.set(bk, b);
    if (ak === bk) {
      return;
    }
    const weight = segmentLength(a, b);
    adjacency.set(ak, [...(adjacency.get(ak) ?? []), {key: bk, weight}]);
    adjacency.set(bk, [...(adjacency.get(bk) ?? []), {key: ak, weight}]);
  };

  segs.forEach((segment, index) => {
    const cuts = [
      {t: 0, x: segment.x1, y: segment.y1},
      {t: 1, x: segment.x2, y: segment.y2},
    ];
    if (index === startSnap.index) {
      cuts.push({t: startSnap.t, x: startSnap.x, y: startSnap.y});
    }
    if (index === endSnap.index) {
      cuts.push({t: endSnap.t, x: endSnap.x, y: endSnap.y});
    }
    cuts.sort((a, b) => a.t - b.t);
    for (let i = 0; i < cuts.length - 1; i += 1) {
      addEdge(cuts[i].x, cuts[i].y, cuts[i + 1].x, cuts[i + 1].y);
    }
  });

  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  const queue = [startKey];
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const key = queue.shift()!;
    if (key === endKey) {
      break;
    }
    for (const edge of adjacency.get(key) ?? []) {
      const nextDist = (dist.get(key) ?? Infinity) + edge.weight;
      if (nextDist < (dist.get(edge.key) ?? Infinity)) {
        dist.set(edge.key, nextDist);
        prev.set(edge.key, key);
        if (!queue.includes(edge.key)) {
          queue.push(edge.key);
        }
      }
    }
  }

  if (!dist.has(endKey)) {
    return straightLine(
      start,
      end,
      'start and destination are on disconnected path segments',
    );
  }

  const chain = [endKey];
  while (chain[chain.length - 1] !== startKey) {
    chain.push(prev.get(chain[chain.length - 1])!);
  }
  chain.reverse();

  const waypoints: RoutePoint[] = [{x: round(start.x), y: round(start.y)}];
  const push = (point: RoutePoint) => {
    const rounded = {x: round(point.x), y: round(point.y)};
    const last = waypoints[waypoints.length - 1];
    if (last.x !== rounded.x || last.y !== rounded.y) {
      waypoints.push(rounded);
    }
  };
  for (const key of chain) {
    const point = coords.get(key);
    if (point) {
      push(point);
    }
  }
  push(end);

  const connectors =
    segmentLength(start, startSnap) + segmentLength(end, endSnap);
  return {
    waypoints,
    length: round((dist.get(endKey) ?? 0) + connectors),
    reachable: true,
  };
}

function parseRoutePoint(point: RoutePoint, label: string) {
  if (!point || typeof point !== 'object') {
    throw new Error(`${label} point is required`);
  }
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label}.x and ${label}.y are required numbers`);
  }
  return {
    id: String(point.id || label),
    name: String(point.name || label),
    x,
    y,
  };
}

export const localBackendApi = {
  async health() {
    await ensureLoaded();
    return {
      status: 'ok',
      mode: 'local',
      beacons: Object.values(state.beacons).map(beacon => beacon.name),
      fingerprint_cells: fingerprintSummary(state.fingerprint).cell_count,
      fingerprint_cells_8f: fingerprintSummary(state.fingerprint8f).cell_count,
      beacons_8f: Object.values(state.beacons8f).map(beacon => beacon.name),
    };
  },

  async beaconsList() {
    await ensureLoaded();
    return {beacons: clone(state.beacons)};
  },

  async beaconsUpsert(beacon: PersistedBeacon) {
    await ensureLoaded();
    const saved = normalizeBeacon(beacon);
    if (!saved.id || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
      throw new Error('id, x, and y are required');
    }
    state.beacons[saved.id] = saved;
    await saveBeacons();
    return {status: 'saved', beacon: saved};
  },

  async beaconsDelete(id: string) {
    await ensureLoaded();
    const removed = Boolean(state.beacons[id]);
    delete state.beacons[id];
    if (removed) {
      await saveBeacons();
    }
    return {removed};
  },

  async beaconsClear() {
    await ensureLoaded();
    state.beacons = {};
    await saveBeacons();
    return {status: 'beacons cleared'};
  },

  async surveyStart(
    x: number,
    y: number,
    samplesTarget: number,
    sid?: string,
  ) {
    await ensureLoaded();
    const samples = Math.max(1, Math.trunc(Number(samplesTarget) || 50));
    const session: SurveySession = {
      sessionId: sessionId(sid),
      x: Number(x),
      y: Number(y),
      samplesTarget: samples,
      startedAt: nowSeconds(),
      buffer: {},
    };
    surveySessions.set(session.sessionId, session);
    return {status: 'survey started', ...snapshotSurvey(session)};
  },

  async surveyEvents(events: RssiEvent[], sid?: string) {
    await ensureLoaded();
    const session = surveySessions.get(sessionId(sid));
    if (!session) {
      throw new Error('no active survey session - call surveyStart first');
    }
    const canonical = canonicalizeEvents(events ?? []);
    let applied = 0;
    for (const event of canonical) {
      const id = event.beacon_id;
      const rssi = Number(event.rssi);
      if (!id || !Number.isFinite(rssi)) {
        continue;
      }
      const bucket = (session.buffer[id] ??= []);
      if (bucket.length < session.samplesTarget) {
        bucket.push(rssi);
        applied += 1;
      }
    }
    return {
      applied,
      received: events?.length ?? 0,
      ...snapshotSurvey(session),
    };
  },

  async surveyProgress(sid?: string) {
    await ensureLoaded();
    const session = surveySessions.get(sessionId(sid));
    return session ? {active: true, ...snapshotSurvey(session)} : {active: false};
  },

  async surveyFinalize(expectedBeacons?: string[], sid?: string) {
    await ensureLoaded();
    const session = surveySessions.get(sessionId(sid));
    if (!session) {
      throw new Error('no active survey session');
    }
    surveySessions.delete(session.sessionId);
    const perBeacon = {...session.buffer};
    for (const id of expectedBeacons ?? []) {
      perBeacon[String(id)] = perBeacon[String(id)] ?? [];
    }
    const cell = upsertCell(session.x, session.y, perBeacon);
    await saveFingerprint();
    return {
      status: 'cell saved',
      cell,
      summary: fingerprintSummary(state.fingerprint),
    };
  },

  async surveyCancel(sid?: string) {
    await ensureLoaded();
    const removed = surveySessions.delete(sessionId(sid));
    return {status: removed ? 'cancelled' : 'no active session'};
  },

  async fingerprintCells() {
    await ensureLoaded();
    return {
      cells: listCells(state.fingerprint),
      summary: fingerprintSummary(state.fingerprint),
    };
  },

  async fingerprintSummary() {
    await ensureLoaded();
    return fingerprintSummary(state.fingerprint);
  },

  async fingerprintDeleteCell(x: number, y: number) {
    await ensureLoaded();
    const key = cellKey(x, y);
    const removed = Boolean(state.fingerprint.cells[key]);
    delete state.fingerprint.cells[key];
    if (removed) {
      await saveFingerprint();
    }
    return {removed};
  },

  async fingerprintClear() {
    await ensureLoaded();
    state.fingerprint = {schema_version: 1, grid_step_m: 1, cells: {}};
    await saveFingerprint();
    return {status: 'fingerprint cleared'};
  },

  async fingerprintMatch(rssi: Record<string, number | null>, topK = TOP_K_DEFAULT) {
    await ensureLoaded();
    const result = matchFingerprint(state.fingerprint, rssi, topK);
    if (!result) {
      return {
        ready: false,
        reason: 'no surveyed cells overlap with the requested beacons',
      };
    }
    return {ready: true, ...result};
  },

  async fpStart(
    opts?: {sigma_a?: number; seed_r_from_loo?: boolean},
    sid?: string,
  ) {
    await ensureLoaded();
    const pipeline = getPipeline(sid);
    if (opts?.sigma_a !== undefined) {
      const sigmaA = Number(opts.sigma_a);
      if (!Number.isFinite(sigmaA)) {
        throw new Error('sigma_a must be numeric');
      }
      pipeline.setParams({sigmaA});
    }
    pipeline.reset();
    const estimate = opts?.seed_r_from_loo === false ? null : pipeline.seedRFromLoo();
    return {
      status: 'fp pipeline started',
      session_id: sessionId(sid),
      r_estimate: estimate,
      fingerprint_summary: fingerprintSummary(state.fingerprint),
    };
  },

  async fpRssiEvents(events: RssiEvent[], sid?: string) {
    await ensureLoaded();
    const pipeline = getPipeline(sid);
    const canonical = canonicalizeEvents(events ?? []);
    const registeredIds = new Set(Object.values(state.beacons).map(beacon => beacon.id));
    const filtered =
      registeredIds.size > 0
        ? canonical.filter(event => registeredIds.has(String(event.beacon_id)))
        : canonical;
    const applied = pipeline.ingestEvents(filtered);
    return {
      applied,
      received: events?.length ?? 0,
      session_id: sessionId(sid),
      rejected_unregistered: canonical.length - filtered.length,
    };
  },

  async fpPositionLatest(sid?: string) {
    await ensureLoaded();
    const pipeline = getPipeline(sid);
    const result = pipeline.updatePosition();
    if (!result) {
      const active = pipeline.status().active_beacons;
      return {
        ready: false,
        session_id: sessionId(sid),
        reason: active.length === 0 ? 'no active beacons yet' : 'fingerprint is empty',
        active_beacons: active,
      };
    }
    if ('_no_overlap' in result) {
      return {
        ready: false,
        session_id: sessionId(sid),
        reason:
          'BLE ids do not match the fingerprint - active beacons are not in the surveyed set',
        active_beacons: result.active_beacons,
        registered_beacons: result.registered_beacons,
      };
    }
    return {ready: true, session_id: sessionId(sid), ...result};
  },

  async fpReset(sid?: string) {
    await ensureLoaded();
    getPipeline(sid).reset();
    return {status: 'fp pipeline reset', session_id: sessionId(sid)};
  },

  async fpStatus(sid?: string) {
    await ensureLoaded();
    return {session_id: sessionId(sid), ...getPipeline(sid).status()};
  },

  async floorDetect(rssi: Record<string, number | null>) {
    await ensureLoaded();
    const rssi6f = resolveRssiForStore(rssi, state.beacons);
    const rssi8f = resolveRssiForStore(rssi, state.beacons8f);
    const score6f = scoreFingerprint(state.fingerprint, rssi6f);
    const score8f = scoreFingerprint(state.fingerprint8f, rssi8f);
    let floor: 6 | 8 | null;
    let reason: string;
    if (!score6f && !score8f) {
      floor = null;
      reason = 'no fingerprint overlap on either floor';
    } else if (!score8f) {
      floor = 6;
      reason = 'no 8F overlap; 6F-only match';
    } else if (!score6f) {
      floor = 8;
      reason = 'no 6F overlap; 8F-only match';
    } else if (score8f.per_beacon_sq_dist < score6f.per_beacon_sq_dist) {
      floor = 8;
      reason = `8F best-cell sq_dist ${score8f.per_beacon_sq_dist.toFixed(
        2,
      )} < 6F ${score6f.per_beacon_sq_dist.toFixed(2)}`;
    } else {
      floor = 6;
      reason = `6F best-cell sq_dist ${score6f.per_beacon_sq_dist.toFixed(
        2,
      )} <= 8F ${score8f.per_beacon_sq_dist.toFixed(2)}`;
    }
    return {
      floor,
      on_8f: floor === 8,
      score_6f: score6f,
      score_8f: score8f,
      reason,
    };
  },

  async fpParams(params: {sigma_a?: number; R?: number[][]}, sid?: string) {
    await ensureLoaded();
    const pipeline = getPipeline(sid);
    const sigmaA =
      params.sigma_a !== undefined ? Number(params.sigma_a) : undefined;
    if (sigmaA !== undefined && !Number.isFinite(sigmaA)) {
      throw new Error('sigma_a must be numeric');
    }
    const r = params.R
      ? [
          [Number(params.R[0][0]), Number(params.R[0][1])],
          [Number(params.R[1][0]), Number(params.R[1][1])],
        ]
      : null;
    pipeline.setParams({sigmaA, r});
    return {status: 'updated', session_id: sessionId(sid), ...pipeline.status()};
  },

  async fpREstimate() {
    await ensureLoaded();
    const estimate = estimateRloo(state.fingerprint);
    if (!estimate) {
      return {ready: false, reason: 'need at least 4 surveyed cells'};
    }
    return {ready: true, ...estimate};
  },

  async fpPathGet() {
    await ensureLoaded();
    return {segments: clone(state.path)};
  },

  async fpPathSet(segments: PathSegment[]) {
    await ensureLoaded();
    state.path = coerceSegments(segments);
    await savePath();
    return {status: 'saved', segments: clone(state.path)};
  },

  async fpRoute(startBeaconId: string, endBeaconId: string) {
    await ensureLoaded();
    if (startBeaconId === endBeaconId) {
      throw new Error('start and destination must be different beacons');
    }
    const start = state.beacons[startBeaconId];
    const end = state.beacons[endBeaconId];
    if (!start || !end) {
      throw new Error(`${!start ? 'start' : 'destination'} beacon is not registered`);
    }
    const route = computeRoute(state.path, start, end);
    return {
      start: {id: start.id, name: start.name, x: start.x, y: start.y},
      end: {id: end.id, name: end.name, x: end.x, y: end.y},
      ...route,
    };
  },

  async fpRoutePoints(startInput: RoutePoint, endInput: RoutePoint) {
    await ensureLoaded();
    const start = parseRoutePoint(startInput, 'start');
    const end = parseRoutePoint(endInput, 'end');
    if (start.x === end.x && start.y === end.y) {
      throw new Error('start and destination must be different points');
    }
    const route = computeRoute(state.path, start, end);
    return {start, end, ...route};
  },
};
