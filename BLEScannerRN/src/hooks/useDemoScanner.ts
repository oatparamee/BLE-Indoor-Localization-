/**
 * useDemoScanner Hook
 *
 * Simulates BLE device scanning with fake devices and fluctuating RSSI
 * values. This allows testing the full UI (including the Kalman Test tab)
 * on a real phone without needing actual BLE beacons nearby.
 *
 * Exposes the same interface as useBLEScanner so the two hooks can be
 * swapped seamlessly via a Demo/Live mode toggle.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { KalmanFilter } from '../utils/KalmanFilter';
import { BLEDeviceInfo } from '../utils/types';

// ── Simulated device definitions ────────────────────────────────────
// Each entry defines a fake BLE device with a name, ID, and base RSSI.
// The RSSI jitters randomly around the base value during simulation.
const MOCK_DEVICES = [
  { id: 'AA:BB:CC:DD:EE:01', name: 'iBeacon Living Room', baseRssi: -45 },
  { id: 'AA:BB:CC:DD:EE:02', name: 'Tile Tracker', baseRssi: -58 },
  { id: 'AA:BB:CC:DD:EE:03', name: 'Unknown', baseRssi: -67 },
  { id: 'AA:BB:CC:DD:EE:04', name: 'Mi Band 8', baseRssi: -73 },
  { id: 'AA:BB:CC:DD:EE:05', name: 'AirTag', baseRssi: -52 },
  { id: 'AA:BB:CC:DD:EE:06', name: 'ESP32_BLE_Beacon', baseRssi: -82 },
  { id: 'AA:BB:CC:DD:EE:07', name: 'Unknown', baseRssi: -91 },
  { id: 'AA:BB:CC:DD:EE:08', name: 'Samsung Galaxy Buds', baseRssi: -63 },
];

/** How much the RSSI can randomly deviate from the base value. */
const RSSI_JITTER = 8;

/** How often (ms) the simulated RSSI values update. */
const UPDATE_INTERVAL_MS = 500;

/** Maximum number of RSSI readings to keep per device for charting. */
const MAX_HISTORY = 30;

export function useDemoScanner() {
  // ── Published state (mirrors useBLEScanner interface) ────────────
  const [devices, setDevices] = useState<BLEDeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Demo mode — tap Scan to start');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────
  // One Kalman filter per simulated device.
  const filtersRef = useRef<Map<string, KalmanFilter>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mutable ref that tracks accumulated history between renders.
  const historyRef = useRef<Map<string, { rssi: number[]; filtered: number[] }>>(new Map());

  /** Generates a random RSSI reading around the device's base value. */
  const jitterRssi = (baseRssi: number): number => {
    const noise = (Math.random() - 0.5) * 2 * RSSI_JITTER;
    return Math.round(baseRssi + noise);
  };

  /** Start the demo simulation — fake devices appear with fluctuating RSSI. */
  const startScanning = useCallback(() => {
    // Initialize Kalman filters for each mock device.
    MOCK_DEVICES.forEach((d) => {
      if (!filtersRef.current.has(d.id)) {
        filtersRef.current.set(d.id, new KalmanFilter(0.1, 1.0, 1.0));
      }
      if (!historyRef.current.has(d.id)) {
        historyRef.current.set(d.id, { rssi: [], filtered: [] });
      }
    });

    // Update device list at a fixed interval.
    intervalRef.current = setInterval(() => {
      const now = Date.now();

      const updated: BLEDeviceInfo[] = MOCK_DEVICES.map((mock) => {
        const rawRssi = jitterRssi(mock.baseRssi);
        const filter = filtersRef.current.get(mock.id)!;
        const filteredRssi = filter.update(rawRssi);

        // Accumulate history for the Kalman Test chart.
        const history = historyRef.current.get(mock.id)!;
        history.rssi = [...history.rssi, rawRssi].slice(-MAX_HISTORY);
        history.filtered = [...history.filtered, filteredRssi].slice(-MAX_HISTORY);

        return {
          id: mock.id,
          name: mock.name,
          rssi: rawRssi,
          filteredRssi,
          lastSeen: now,
          rssiHistory: [...history.rssi],
          filteredHistory: [...history.filtered],
        };
      });

      // Sort by filtered RSSI (strongest first).
      updated.sort((a, b) => b.filteredRssi - a.filteredRssi);
      setDevices(updated);
    }, UPDATE_INTERVAL_MS);

    setIsScanning(true);
    setStatusMessage('Demo mode — scanning simulated devices...');
  }, []);

  /** Stop the demo simulation. */
  const stopScanning = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsScanning(false);
    setStatusMessage('Demo mode — scanning stopped');
  }, []);

  // Cleanup on unmount.
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
    bluetoothOff: false, // Never off in demo mode
    startScanning,
    stopScanning,
    selectedDeviceId,
    setSelectedDeviceId,
  };
}
