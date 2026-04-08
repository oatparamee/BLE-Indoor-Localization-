/**
 * useBLEScanner Hook
 *
 * Encapsulates all BLE scanning logic:
 *   - Initializes the BleManager from react-native-ble-plx
 *   - Requests Bluetooth & Location permissions on Android/iOS
 *   - Starts continuous scanning for all nearby BLE peripherals
 *   - Maintains a live list of detected devices with Kalman-filtered RSSI
 *   - Automatically removes stale devices that haven't been seen recently
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import { KalmanFilter } from '../utils/KalmanFilter';
import { BLEDeviceInfo } from '../utils/types';

/** How many seconds before a device is considered stale and removed. */
const STALE_TIMEOUT_MS = 10_000;

/** How often (ms) the cleanup timer runs to prune stale devices. */
const CLEANUP_INTERVAL_MS = 2_000;

export function useBLEScanner() {
  // ── Published state ──────────────────────────────────────────────
  const [devices, setDevices] = useState<BLEDeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [bluetoothOff, setBluetoothOff] = useState(false);

  // ── Refs (persist across renders without causing re-renders) ────
  /** The BLE manager instance — created once and reused. */
  const managerRef = useRef<BleManager | null>(null);

  /** Map of device ID → KalmanFilter instance for per-device smoothing. */
  const filtersRef = useRef<Map<string, KalmanFilter>>(new Map());

  /** Mutable ref to the latest devices array (avoids stale closures). */
  const devicesRef = useRef<BLEDeviceInfo[]>([]);

  // Keep the ref in sync with state.
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // ── Permission request ──────────────────────────────────────────
  /**
   * Requests the necessary permissions for BLE scanning.
   * - Android 12+: BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION
   * - Android < 12: ACCESS_FINE_LOCATION only
   * - iOS: permissions are requested automatically by the system via Info.plist
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const apiLevel = Platform.Version;

      if (apiLevel >= 31) {
        // Android 12+ requires new Bluetooth permissions.
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
        // Older Android only needs location permission for BLE scanning.
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );

        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setStatusMessage('Location permission denied');
          return false;
        }
      }
    }

    // iOS handles permission prompts automatically.
    return true;
  }, []);

  // ── Start scanning ─────────────────────────────────────────────
  /**
   * Begins scanning for all nearby BLE peripherals.
   * `allowDuplicates: true` ensures repeated advertisements from the
   * same device are reported, giving us continuous RSSI updates.
   */
  const startScanning = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    // Scan for all service UUIDs (null) with duplicate reporting.
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn('BLE scan error:', error.message);
        setStatusMessage(`Scan error: ${error.message}`);
        return;
      }

      if (!device) return;

      // Ignore devices with no valid RSSI reading.
      if (device.rssi === null || device.rssi === undefined) return;

      processDevice(device);
    });

    setIsScanning(true);
    setStatusMessage('Scanning for BLE devices...');
  }, []);

  // ── Stop scanning ──────────────────────────────────────────────
  const stopScanning = useCallback(() => {
    managerRef.current?.stopDeviceScan();
    setIsScanning(false);
    setStatusMessage('Scanning stopped');
  }, []);

  // ── Process a discovered device ────────────────────────────────
  /**
   * Called for every BLE advertisement received. Updates the device
   * list with fresh RSSI data, applying the Kalman filter.
   */
  const processDevice = useCallback((device: Device) => {
    const rssi = device.rssi ?? 0;
    const deviceId = device.id;
    const deviceName = device.localName || device.name || 'Unknown';

    // Retrieve or create a Kalman filter for this device.
    if (!filtersRef.current.has(deviceId)) {
      filtersRef.current.set(
        deviceId,
        new KalmanFilter(0.1, 1.0, 1.0) // Q=0.1, R=1.0, P=1.0
      );
    }
    const filter = filtersRef.current.get(deviceId)!;
    const filteredRssi = filter.update(rssi);

    setDevices((prev) => {
      const existingIndex = prev.findIndex((d) => d.id === deviceId);

      let updated: BLEDeviceInfo[];

      if (existingIndex >= 0) {
        // Update existing device with fresh readings.
        updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          rssi,
          filteredRssi,
          lastSeen: Date.now(),
          // Only update name if we now have a real one.
          name: deviceName !== 'Unknown' ? deviceName : updated[existingIndex].name,
        };
      } else {
        // Add newly discovered device.
        updated = [
          ...prev,
          {
            id: deviceId,
            name: deviceName,
            rssi,
            filteredRssi,
            lastSeen: Date.now(),
          },
        ];
      }

      // Sort by filtered RSSI (strongest signal first).
      updated.sort((a, b) => b.filteredRssi - a.filteredRssi);
      return updated;
    });
  }, []);

  // ── Initialization & cleanup ───────────────────────────────────
  useEffect(() => {
    // Create the BLE manager instance.
    const manager = new BleManager();
    managerRef.current = manager;

    /**
     * Monitor Bluetooth adapter state changes.
     * Auto-start scanning when Bluetooth powers on;
     * show an alert when it powers off.
     */
    const stateSubscription = manager.onStateChange((state: State) => {
      if (state === State.PoweredOn) {
        setBluetoothOff(false);
        setStatusMessage('Bluetooth is powered on');
        // Request permissions, then start scanning.
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
    }, true); // `true` = also fire with the current state immediately.

    // Periodic timer to remove devices not seen within STALE_TIMEOUT_MS.
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setDevices((prev) => {
        const fresh = prev.filter((d) => now - d.lastSeen < STALE_TIMEOUT_MS);

        // Clean up Kalman filters for removed devices.
        const freshIds = new Set(fresh.map((d) => d.id));
        for (const [id] of filtersRef.current) {
          if (!freshIds.has(id)) {
            filtersRef.current.delete(id);
          }
        }

        return fresh;
      });
    }, CLEANUP_INTERVAL_MS);

    // Teardown: stop scanning, remove listeners, destroy manager.
    return () => {
      manager.stopDeviceScan();
      stateSubscription.remove();
      clearInterval(cleanupInterval);
      manager.destroy();
    };
  }, [requestPermissions, startScanning]);

  return {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff,
    startScanning,
    stopScanning,
  };
}
