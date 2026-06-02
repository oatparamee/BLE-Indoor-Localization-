import AsyncStorage from '@react-native-async-storage/async-storage';

const SIGMA_A_STORAGE_KEY = '@ble_fusion_sigma_a_v1';

export const DEFAULT_FUSION_SIGMA_A = 0.5;

let cachedSigmaA = DEFAULT_FUSION_SIGMA_A;

function normalizeSigmaA(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : Number(String(value).trim());

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function loadFusionSigmaA(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(SIGMA_A_STORAGE_KEY);
    const parsed = normalizeSigmaA(stored);
    if (parsed !== null) {
      cachedSigmaA = parsed;
    }
  } catch {
    // Use the last cached/default value.
  }

  return cachedSigmaA;
}

export async function saveFusionSigmaA(sigmaA: number): Promise<void> {
  const parsed = normalizeSigmaA(sigmaA);
  if (parsed === null) {
    return;
  }

  cachedSigmaA = parsed;
  await AsyncStorage.setItem(SIGMA_A_STORAGE_KEY, String(parsed));
}

export function getCachedFusionSigmaA(): number {
  return cachedSigmaA;
}
