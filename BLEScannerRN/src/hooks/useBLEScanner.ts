/**
 * useBLEScanner Hook
 *
 * Encapsulates all BLE scanning logic:
 *   - Initializes the BleManager from react-native-ble-plx
 *   - Requests Bluetooth & Location permissions on Android/iOS
 *   - Starts continuous scanning for all nearby BLE peripherals
 *   - Maintains a live list of detected devices with Kalman-filtered RSSI
 *   - Automatically removes stale devices that haven't been seen recently
 *
 * IMPORTANT: We do not statically import `react-native-ble-plx`. A static import
 * loads the native module as soon as the bundle evaluates, which crashes or
 * freezes Expo Go (no BLE native module). We only `require()` after checking
 * that we are not in Expo Go and the hook is enabled (Live mode).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import Constants from 'expo-constants';
import type { Device } from 'react-native-ble-plx';
import { KalmanFilter } from '../utils/KalmanFilter';
import { BLEDeviceInfo } from '../utils/types';

/** How many seconds before a device is considered stale and removed. */
const STALE_TIMEOUT_MS = 10_000;

/** Maximum number of RSSI readings to keep per device for charting. */
const MAX_HISTORY = 30;

/** How often (ms) the cleanup timer runs to prune stale devices. */
const CLEANUP_INTERVAL_MS = 2_000;

/** True when running inside the Expo Go client (no custom native BLE). */
function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

type BlePlxModule = typeof import('react-native-ble-plx');

function loadBlePlxModule(): BlePlxModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-ble-plx') as BlePlxModule;
  } catch {
    return null;
  }
}

export function useBLEScanner(enabled: boolean = true) {
  const [devices, setDevices] = useState<BLEDeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [bluetoothOff, setBluetoothOff] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const managerRef = useRef<InstanceType<BlePlxModule['BleManager']> | null>(null);

  const filtersRef = useRef<Map<string, KalmanFilter>>(new Map());
  const devicesRef = useRef<BLEDeviceInfo[]>([]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const apiLevel = Platform.Version;

      if (apiLevel >= 31) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        const allGranted = Object.values(results).every(
          (r) => r === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          setStatusMessage('Bluetooth permissions denied');
          return false;
        }
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );

        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setStatusMessage('Location permission denied');
          return false;
        }
      }
    }

    return true;
  }, []);

  const processDevice = useCallback((device: Device) => {
    const rssi = device.rssi ?? 0;
    const deviceId = device.id;
    const deviceName = device.localName || device.name || 'Unknown';

    if (!filtersRef.current.has(deviceId)) {
      filtersRef.current.set(deviceId, new KalmanFilter(0.1, 1.0, 1.0));
    }
    const filter = filtersRef.current.get(deviceId)!;
    const filteredRssi = filter.update(rssi);

    setDevices((prev) => {
      const existingIndex = prev.findIndex((d) => d.id === deviceId);

      let updated: BLEDeviceInfo[];

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const newRssiHistory = [...existing.rssiHistory, rssi].slice(-MAX_HISTORY);
        const newFilteredHistory = [...existing.filteredHistory, filteredRssi].slice(-MAX_HISTORY);
        updated = [...prev];
        updated[existingIndex] = {
          ...existing,
          rssi,
          filteredRssi,
          lastSeen: Date.now(),
          rssiHistory: newRssiHistory,
          filteredHistory: newFilteredHistory,
          name: deviceName !== 'Unknown' ? deviceName : existing.name,
        };
      } else {
        updated = [
          ...prev,
          {
            id: deviceId,
            name: deviceName,
            rssi,
            filteredRssi,
            lastSeen: Date.now(),
            rssiHistory: [rssi],
            filteredHistory: [filteredRssi],
          },
        ];
      }

      updated.sort((a, b) => b.filteredRssi - a.filteredRssi);
      return updated;
    });
  }, []);

  const startScanning = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn('BLE scan error:', error.message);
        setStatusMessage(`Scan error: ${error.message}`);
        return;
      }

      if (!device) return;

      if (device.rssi === null || device.rssi === undefined) return;

      processDevice(device);
    });

    setIsScanning(true);
    setStatusMessage('Scanning for BLE devices...');
  }, [processDevice]);

  const stopScanning = useCallback(() => {
    managerRef.current?.stopDeviceScan();
    setIsScanning(false);
    setStatusMessage('Scanning stopped');
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatusMessage('Switch to Live mode to scan');
      return;
    }

    if (isExpoGo()) {
      setStatusMessage('Live BLE is not available in Expo Go — use Demo mode or a dev build');
      return;
    }

    const ble = loadBlePlxModule();
    if (!ble) {
      setStatusMessage('BLE native module not found — rebuild with prebuild');
      return;
    }

    const { BleManager, State } = ble;

    let manager: InstanceType<typeof BleManager>;
    try {
      manager = new BleManager();
    } catch {
      setStatusMessage('BLE not available — use a development build');
      return;
    }
    managerRef.current = manager;

    const stateSubscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        setBluetoothOff(false);
        setStatusMessage('Bluetooth is powered on');
        requestPermissions().then((granted) => {
          if (granted) {
            startScanning();
          }
        });
      } else if (state === State.PoweredOff) {
        setBluetoothOff(true);
        setIsScanning(false);
        setStatusMessage('Bluetooth is turned off');
      } else if (state === State.Unauthorized) {
        setStatusMessage('Bluetooth permission denied');
      }
    }, true);

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setDevices((prev) => {
        const fresh = prev.filter((d) => now - d.lastSeen < STALE_TIMEOUT_MS);

        const freshIds = new Set(fresh.map((d) => d.id));
        for (const [id] of filtersRef.current) {
          if (!freshIds.has(id)) {
            filtersRef.current.delete(id);
          }
        }

        return fresh;
      });
    }, CLEANUP_INTERVAL_MS);

    return () => {
      manager.stopDeviceScan();
      stateSubscription.remove();
      clearInterval(cleanupInterval);
      manager.destroy();
      managerRef.current = null;
    };
  }, [enabled, requestPermissions, startScanning]);

  return {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff,
    startScanning,
    stopScanning,
    selectedDeviceId,
    setSelectedDeviceId,
  };
}
