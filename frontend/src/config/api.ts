/**
 * Backend API configuration.
 *
 * The URL is stored in AsyncStorage so users can change it
 * from the Settings tab without editing code.
 * Default is used on first launch only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'backend_url';
const DEFAULT_URL = 'http://192.168.1.100:5000'; // Change this accordingly

let _cachedUrl: string = DEFAULT_URL;
let _loaded = false;

export async function loadApiUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cachedUrl = stored;
    }
  } catch {
    // Use default
  }
  _loaded = true;
  return _cachedUrl;
}

export async function saveApiUrl(url: string): Promise<void> {
  _cachedUrl = url;
  await AsyncStorage.setItem(STORAGE_KEY, url);
}

export function getApiUrl(): string {
  return _cachedUrl;
}
