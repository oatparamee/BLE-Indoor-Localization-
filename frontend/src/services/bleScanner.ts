/**
 * BLE Scanner Service
 *
 * Uses react-native-ble-plx to actively scan for BLE beacons.
 * Maintains a rolling buffer of RSSI readings per beacon,
 * computes a smoothed (averaged) RSSI, and tracks whether
 * each beacon is ACTIVE or LOST.
 */

import {BleManager, Device, State} from 'react-native-ble-plx';
import {PermissionsAndroid, Platform} from 'react-native';
import {
  BEACON_NAMES,
  RSSI_BUFFER_SIZE,
  BEACON_LOST_TIMEOUT_MS,
} from '../config/beacons';

export interface BeaconReading {
  name: string;
  rawRssi: number | null;
  smoothedRssi: number | null;
  lastSeen: number;
  active: boolean;
  rssiBuffer: number[];
}

type ScanCallback = (readings: Record<string, BeaconReading>) => void;

class BLEScanner {
  private manager: BleManager;
  private readings: Record<string, BeaconReading> = {};
  private callback: ScanCallback | null = null;
  private scanning = false;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.manager = new BleManager();
    this._initReadings();
  }

  private _initReadings() {
    for (const name of BEACON_NAMES) {
      this.readings[name] = {
        name,
        rawRssi: null,
        smoothedRssi: null,
        lastSeen: 0,
        active: false,
        rssiBuffer: [],
      };
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const apiLevel = Platform.Version;
      if (apiLevel >= 31) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return Object.values(results).every(
          r => r === PermissionsAndroid.RESULTS.GRANTED,
        );
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  }

  async startScanning(cb: ScanCallback): Promise<void> {
    this.callback = cb;

    const permitted = await this.requestPermissions();
    if (!permitted) {
      console.warn('BLE permissions not granted');
      return;
    }

    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      console.warn('Bluetooth is not powered on, current state:', state);
      return;
    }

    this.scanning = true;

    this.manager.startDeviceScan(null, {allowDuplicates: true}, (_error, device) => {
      if (!device || !device.name) {
        return;
      }
      this._handleDevice(device);
    });

    this.updateInterval = setInterval(() => {
      this._checkLostBeacons();
      if (this.callback) {
        this.callback({...this.readings});
      }
    }, 1000);
  }

  private _handleDevice(device: Device) {
    const name = device.name || device.localName;
    if (!name || !BEACON_NAMES.includes(name)) {
      return;
    }

    const rssi = device.rssi;
    if (rssi === null || rssi === undefined) {
      return;
    }

    const beacon = this.readings[name];
    beacon.rawRssi = rssi;
    beacon.lastSeen = Date.now();
    beacon.active = true;

    beacon.rssiBuffer.push(rssi);
    if (beacon.rssiBuffer.length > RSSI_BUFFER_SIZE) {
      beacon.rssiBuffer.shift();
    }

    const sum = beacon.rssiBuffer.reduce((a, b) => a + b, 0);
    beacon.smoothedRssi = sum / beacon.rssiBuffer.length;
  }

  private _checkLostBeacons() {
    const now = Date.now();
    for (const name of BEACON_NAMES) {
      const beacon = this.readings[name];
      if (beacon.lastSeen > 0 && now - beacon.lastSeen > BEACON_LOST_TIMEOUT_MS) {
        beacon.active = false;
      }
    }
  }

  stopScanning() {
    this.scanning = false;
    this.manager.stopDeviceScan();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  getReadings(): Record<string, BeaconReading> {
    return {...this.readings};
  }

  destroy() {
    this.stopScanning();
    this.manager.destroy();
  }
}

export const bleScanner = new BLEScanner();
