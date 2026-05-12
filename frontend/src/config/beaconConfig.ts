import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedBeacon {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Per-beacon 1D Kalman process noise (filled by the RSSI Profile screen
   *  or set manually in the Beacons tab). Optional — beacons without a
   *  value fall back to the backend's global default. */
  q?: number;
  /** Per-beacon 1D Kalman measurement noise — same rules as q. */
  r?: number;
}

const STORAGE_KEY = '@ble_beacon_config_v1';
let cached: Record<string, SavedBeacon> = {};

export async function loadBeaconConfig(): Promise<Record<string, SavedBeacon>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cached = parsed;
      }
    }
  } catch {}
  return cached;
}

export async function saveBeacon(beacon: SavedBeacon): Promise<void> {
  cached[beacon.id] = beacon;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
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
  cached[id] = {...existing, q, r};
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  return true;
}

export async function deleteBeacon(id: string): Promise<void> {
  delete cached[id];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

export function getBeaconConfig(): Record<string, SavedBeacon> {
  return cached;
}
