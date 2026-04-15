/**
 * BLE Scanner Service
 *
 * Scans ALL nearby BLE devices. Any device whose name matches
 * a key in the BEACONS config is treated as a known beacon
 * and gets RSSI buffering, smoothing, and distance calculation.
 *
 * Devices not in the config are still shown in the nearby list
 * so you can discover what your ESP32s are broadcasting.
 */

import {BleManager, Device, State} from 'react-native-ble-plx';
import {PermissionsAndroid, Platform} from 'react-native';
import {
  BEACONS,
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

export interface NearbyDevice {
  id: string;
  name: string;
  rssi: number | null;
  lastSeen: number;
  isConfigured: boolean;
}

type ScanCallback = (
  readings: Record<string, BeaconReading>,
  nearby: NearbyDevice[],
) => void;

class BLEScanner {
  private manager: BleManager;
  private readings: Record<string, BeaconReading> = {};
  private nearbyDevices: Map<string, NearbyDevice> = new Map();
  private callback: ScanCallback | null = null;
  private scanning = false;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  private _getOrCreateReading(name: string): BeaconReading {
    if (!this.readings[name]) {
      this.readings[name] = {
        name,
        rawRssi: null,
        smoothedRssi: null,
        lastSeen: 0,
        active: false,
        rssiBuffer: [],
      };
    }
    return this.readings[name];
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
      if (!device) {
        return;
      }
      const name = device.name || device.localName;
      if (!name) {
        return;
      }

      const isConfigured = name in BEACONS;
      this.nearbyDevices.set(device.id, {
        id: device.id,
        name,
        rssi: device.rssi,
        lastSeen: Date.now(),
        isConfigured,
      });

      if (isConfigured && device.rssi !== null && device.rssi !== undefined) {
        this._updateBeaconReading(name, device.rssi);
      }
    });

    this.updateInterval = setInterval(() => {
      this._checkLostBeacons();
      this._pruneNearbyDevices();
      if (this.callback) {
        this.callback({...this.readings}, this._getNearbyList());
      }
    }, 1000);
  }

  private _updateBeaconReading(name: string, rssi: number) {
    const beacon = this._getOrCreateReading(name);
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
    for (const beacon of Object.values(this.readings)) {
      if (beacon.lastSeen > 0 && now - beacon.lastSeen > BEACON_LOST_TIMEOUT_MS) {
        beacon.active = false;
      }
    }
  }

  private _pruneNearbyDevices() {
    const cutoff = Date.now() - 10000;
    for (const [id, dev] of this.nearbyDevices) {
      if (dev.lastSeen < cutoff) {
        this.nearbyDevices.delete(id);
      }
    }
  }

  private _getNearbyList(): NearbyDevice[] {
    return Array.from(this.nearbyDevices.values())
      .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
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
