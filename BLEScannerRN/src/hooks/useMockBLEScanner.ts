import { useCallback, useEffect, useRef, useState } from 'react';
import { mockBeaconSeeds, getMockRssi } from '../data/mockBLEDevices';
import { KalmanFilter } from '../utils/KalmanFilter';
import { BLEDeviceInfo, BLEScannerController } from '../utils/types';

const MAX_HISTORY = 30;
const TICK_INTERVAL_MS = 1300;

function buildMockDevices(
  previousDevices: BLEDeviceInfo[],
  tick: number,
  filters: Map<string, KalmanFilter>
): BLEDeviceInfo[] {
  const previousById = new Map(previousDevices.map((device) => [device.id, device]));
  const now = Date.now();

  return mockBeaconSeeds
    .map((seed) => {
      const previous = previousById.get(seed.id);
      if (!filters.has(seed.id)) {
        filters.set(seed.id, new KalmanFilter(0.12, 1.4, 1.0));
      }

      const nextRssi = getMockRssi(seed, tick);
      const filteredRssi = filters.get(seed.id)!.update(nextRssi);

      return {
        id: seed.id,
        name: seed.name,
        rssi: nextRssi,
        filteredRssi,
        lastSeen: now,
        rssiHistory: previous
          ? [...previous.rssiHistory, nextRssi].slice(-MAX_HISTORY)
          : [nextRssi],
        filteredHistory: previous
          ? [...previous.filteredHistory, filteredRssi].slice(-MAX_HISTORY)
          : [filteredRssi],
      };
    })
    .sort((left, right) => right.filteredRssi - left.filteredRssi);
}

export function useMockBLEScanner(): BLEScannerController {
  const [devices, setDevices] = useState<BLEDeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Preview data is ready');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const filtersRef = useRef<Map<string, KalmanFilter>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(0);
  const devicesRef = useRef<BLEDeviceInfo[]>([]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const stopScanning = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsScanning(false);
    setStatusMessage(
      devicesRef.current.length > 0 ? 'Preview paused' : 'Preview data is ready'
    );
  }, []);

  const startScanning = useCallback(() => {
    if (intervalRef.current) {
      return;
    }

    setDevices((previous) => buildMockDevices(previous, tickRef.current, filtersRef.current));
    setIsScanning(true);
    setStatusMessage('Previewing nearby beacon traffic');

    intervalRef.current = setInterval(() => {
      tickRef.current += 1;
      setDevices((previous) =>
        buildMockDevices(previous, tickRef.current, filtersRef.current)
      );
    }, TICK_INTERVAL_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff: false,
    startScanning,
    stopScanning,
    selectedDeviceId,
    setSelectedDeviceId,
  };
}
