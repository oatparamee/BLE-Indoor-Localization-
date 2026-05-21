import AsyncStorage from '@react-native-async-storage/async-storage';
import {api, PersistedBeacon} from '../services/api';

/**
 * Beacon registry — backed by the Flask backend at /beacons (persisted
 * to backend/data/beacons.json). Same exported API as before, so the
 * screens that import this module don't need to change.
 *
 * AsyncStorage is no longer the source of truth. It stays referenced
 * only for a ONE-TIME migration: if the backend is empty on first load
 * AND AsyncStorage has data from a previous session, we push the local
 * entries up to the backend and then clear the local store.
 */

export interface SavedBeacon {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Per-beacon 1D Kalman process noise (used only by the legacy
   *  trilateration pipeline). Optional. */
  q?: number;
  /** Per-beacon 1D Kalman measurement noise — same rules as q. */
  r?: number;
  /** Apple iBeacon proximity UUID configured in KBeaconPro
   *  (upper-case 8-4-4-4-12). Optional — when present, the scanner
   *  uses (uuid, major, minor) as the primary match key, which is
   *  stable across phones unlike iOS CoreBluetooth's device.id. */
  uuid?: string;
  /** iBeacon Major (0-65535). */
  major?: number;
  /** iBeacon Minor (0-65535). */
  minor?: number;
  /** Alternate advertised names this beacon is known to broadcast.
   *  iOS reports a beacon's name inconsistently across phones, so one
   *  physical beacon can appear under several names — each resolves to
   *  the same beacon at match time. */
  aliases?: string[];
}

const LEGACY_STORAGE_KEY = '@ble_beacon_config_v1';
let cached: Record<string, SavedBeacon> = {};
let migrationDone = false;

function normalize(b: PersistedBeacon | SavedBeacon): SavedBeacon {
  const out: SavedBeacon = {
    id: String(b.id),
    name: String(b.name ?? b.id),
    x: Number(b.x),
    y: Number(b.y),
  };
  if (typeof b.q === 'number' && Number.isFinite(b.q)) out.q = b.q;
  if (typeof b.r === 'number' && Number.isFinite(b.r)) out.r = b.r;
  if (typeof b.uuid === 'string' && b.uuid.trim()) {
    out.uuid = b.uuid.trim().toUpperCase();
  }
  if (typeof b.major === 'number' && Number.isFinite(b.major)) {
    out.major = b.major;
  }
  if (typeof b.minor === 'number' && Number.isFinite(b.minor)) {
    out.minor = b.minor;
  }
  if (Array.isArray(b.aliases)) {
    const cleaned = b.aliases
      .map(a => String(a).trim())
      .filter(a => a.length > 0);
    if (cleaned.length > 0) out.aliases = cleaned;
  }
  return out;
}

async function migrateFromAsyncStorageIfNeeded(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const entries = Object.values(parsed as Record<string, SavedBeacon>);
    if (entries.length === 0) return;
    for (const b of entries) {
      try {
        await api.beaconsUpsert(normalize(b));
      } catch {
        // Backend unavailable — bail and retry next time the screen mounts.
        migrationDone = false;
        return;
      }
    }
    // Once everything is safely on the backend, drop the local copy.
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Any failure here just leaves AsyncStorage untouched; we'll retry.
    migrationDone = false;
  }
}

export async function loadBeaconConfig(): Promise<Record<string, SavedBeacon>> {
  try {
    const result = await api.beaconsList();
    const beacons = result?.beacons ?? {};
    if (Object.keys(beacons).length === 0) {
      // Backend empty — see if we have anything to migrate up.
      await migrateFromAsyncStorageIfNeeded();
      const after = await api.beaconsList();
      cached = {};
      for (const [bid, b] of Object.entries(after?.beacons ?? {})) {
        cached[bid] = normalize(b as PersistedBeacon);
      }
    } else {
      cached = {};
      for (const [bid, b] of Object.entries(beacons)) {
        cached[bid] = normalize(b as PersistedBeacon);
      }
      // Backend is populated — nuke any stale local copy.
      if (!migrationDone) {
        try {
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {}
        migrationDone = true;
      }
    }
  } catch {
    // Backend unreachable: serve what we have in memory.
  }
  return cached;
}

export async function saveBeacon(beacon: SavedBeacon): Promise<void> {
  const clean = normalize(beacon);
  await api.beaconsUpsert(clean);
  cached[clean.id] = clean;
}

/** Merge Q/R into an existing saved beacon. Returns false if the beacon
 *  isn't in beaconConfig yet (set it up in the Beacons tab first). */
export async function saveBeaconKalman(
  id: string,
  q: number,
  r: number,
): Promise<boolean> {
  const existing = cached[id];
  if (!existing) return false;
  const next: SavedBeacon = {...existing, q, r};
  await api.beaconsUpsert(next);
  cached[id] = next;
  return true;
}

export async function deleteBeacon(id: string): Promise<void> {
  await api.beaconsDelete(id);
  delete cached[id];
}

/** Synchronous accessor for screens that need the current cache without
 *  awaiting. Call loadBeaconConfig() at least once first to populate it. */
export function getBeaconConfig(): Record<string, SavedBeacon> {
  return cached;
}
