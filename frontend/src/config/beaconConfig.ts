import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedBeacon {
  id: string;
  name: string;
  x: number;
  y: number;
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

export async function deleteBeacon(id: string): Promise<void> {
  delete cached[id];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

export function getBeaconConfig(): Record<string, SavedBeacon> {
  return cached;
}
