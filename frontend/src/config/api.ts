/**
 * Backend API configuration.
 *
 * Default mode is local: the React Native app runs the positioning,
 * fingerprinting, routing, and survey persistence on the phone. Remote
 * mode is still available for comparing against the Flask backend.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ApiMode = 'local' | 'remote';

const URL_STORAGE_KEY = 'backend_url';
const MODE_STORAGE_KEY = 'backend_mode';
const DEFAULT_URL = 'http://192.168.1.100:5001';
const DEFAULT_MODE: ApiMode = 'local';

let _cachedUrl: string = DEFAULT_URL;
let _cachedMode: ApiMode = DEFAULT_MODE;

export async function loadApiUrl(): Promise<string> {
  try {
    const [[, storedUrl], [, storedMode]] = await AsyncStorage.multiGet([
      URL_STORAGE_KEY,
      MODE_STORAGE_KEY,
    ]);
    if (storedMode === 'local' || storedMode === 'remote') {
      _cachedMode = storedMode;
    }
    if (storedUrl) {
      _cachedUrl = storedUrl;
    }
  } catch {
    // Use defaults
  }
  return _cachedUrl;
}

export async function saveApiUrl(url: string): Promise<void> {
  _cachedUrl = url;
  await AsyncStorage.setItem(URL_STORAGE_KEY, url);
}

export function getApiUrl(): string {
  return _cachedUrl;
}

export async function loadApiMode(): Promise<ApiMode> {
  try {
    const stored = await AsyncStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'local' || stored === 'remote') {
      _cachedMode = stored;
    }
  } catch {
    // Use default
  }
  return _cachedMode;
}

export async function saveApiMode(mode: ApiMode): Promise<void> {
  _cachedMode = mode;
  await AsyncStorage.setItem(MODE_STORAGE_KEY, mode);
}

export function getApiMode(): ApiMode {
  return _cachedMode;
}
