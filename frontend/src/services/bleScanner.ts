/**
 * BLE Scanner Service
 *
 * Scans ALL nearby BLE devices that advertise a name. Every named device
 * is tracked as a BeaconReading (keyed by its stable UUID / device.id),
 * with RSSI buffering, smoothing, and liveness tracking.
 *
 * The scanner is a singleton but supports MULTIPLE subscribers so that
 * every screen (Calibration, LiveReadings, Position) can receive
 * updates at the same time. Register a listener with `subscribe()` and
 * keep the returned unsubscribe function; the underlying BLE scan runs
 * for as long as there is at least one subscriber and is automatically
 * stopped when the last listener unsubscribes.
 */

import {BleManager, State} from 'react-native-ble-plx';
import {PermissionsAndroid, Platform} from 'react-native';
import {RSSI_BUFFER_SIZE, BEACON_LOST_TIMEOUT_MS} from '../config/beacons';

export interface BeaconReading {
  /** Stable BLE device identifier (MAC on Android, system UUID on iOS). */
  id: string;
  /** Advertised BLE name (e.g. "Beacon_A" or any custom name). */
  name: string;
  rawRssi: number | null;
  smoothedRssi: number | null;
  lastSeen: number;
  active: boolean;
  rssiBuffer: number[];
}

/** @deprecated Use BeaconReading directly — kept as alias for backward compat. */
export type NearbyDevice = BeaconReading;

export type ScanCallback = (
  readings: Record<string, BeaconReading>,
  nearby: BeaconReading[],
) => void;

class BLEScanner {
  private manager: BleManager;
  private readings: Record<string, BeaconReading> = {};
  private listeners: Set<ScanCallback> = new Set();
  private scanning = false;
  private starting = false;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  private _getOrCreateReading(id: string, name: string): BeaconReading {
    if (!this.readings[id]) {
      this.readings[id] = {
        id,
        name,
        rawRssi: null,
        smoothedRssi: null,
        lastSeen: 0,
        active: false,
        rssiBuffer: [],
      };
    } else if (name && this.readings[id].name !== name) {
      this.readings[id].name = name;
    }
    return this.readings[id];
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

  /**
   * Register a listener. Returns an unsubscribe function that MUST be
   * called when the consumer is done (e.g. in a React useEffect cleanup).
   * The underlying BLE scan starts when the first listener subscribes
   * and stops automatically when the last one unsubscribes.
   */
  subscribe(cb: ScanCallback): () => void {
    this.listeners.add(cb);

    // Push current state so the new subscriber has something to render
    // right away, even before the next scan tick fires.
    try {
      cb({...this.readings}, this._getNearbyList());
    } catch {
      // Ignore listener errors
    }

    if (!this.scanning && !this.starting) {
      this._startUnderlyingScan().catch(() => {});
    }

    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        this._stopUnderlyingScan();
      }
    };
  }

  /**
   * Back-compat wrapper for callers that used the old single-callback
   * API. Returns a Promise that resolves once the scan is running.
   * Prefer `subscribe()` in new code — it gives you a tidy unsub handle.
   */
  async startScanning(cb: ScanCallback): Promise<() => void> {
    const unsub = this.subscribe(cb);
    return unsub;
  }

  /**
   * Force-stop the scan regardless of subscribers. Kept for screens
   * like LiveReadings that expose an explicit "Stop" button.
   */
  stopScanning() {
    this.listeners.clear();
    this._stopUnderlyingScan();
  }

  private async _startUnderlyingScan(): Promise<void> {
    if (this.scanning || this.starting) return;
    this.starting = true;

    const permitted = await this.requestPermissions();
    if (!permitted) {
      console.warn('BLE permissions not granted');
      this.starting = false;
      return;
    }

    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      console.warn('Bluetooth is not powered on, current state:', state);
      this.starting = false;
      return;
    }

    this.scanning = true;
    this.starting = false;

    this.manager.startDeviceScan(null, {allowDuplicates: true}, (_error, device) => {
      if (!device) {
        return;
      }
      const name = device.name || device.localName;
      if (!name) {
        return;
      }
      if (device.rssi === null || device.rssi === undefined) {
        return;
      }
      this._updateBeaconReading(device.id, name, device.rssi);
    });

    this.updateInterval = setInterval(() => {
      this._checkLostBeacons();
      this._pruneStaleReadings();
      this._broadcast();
    }, 1000);
  }

  private _stopUnderlyingScan() {
    this.scanning = false;
    this.starting = false;
    this.manager.stopDeviceScan();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private _broadcast() {
    if (this.listeners.size === 0) return;
    const snapshot = {...this.readings};
    const nearby = this._getNearbyList();
    for (const cb of this.listeners) {
      try {
        cb(snapshot, nearby);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private _updateBeaconReading(id: string, name: string, rssi: number) {
    const beacon = this._getOrCreateReading(id, name);
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

  /** Drop readings that haven't been seen for a long time to keep the list tidy. */
  private _pruneStaleReadings() {
    const cutoff = Date.now() - 60_000;
    for (const [id, r] of Object.entries(this.readings)) {
      if (r.lastSeen > 0 && r.lastSeen < cutoff) {
        delete this.readings[id];
      }
    }
  }

  private _getNearbyList(): BeaconReading[] {
    return Object.values(this.readings).sort(
      (a, b) => (b.rawRssi ?? -999) - (a.rawRssi ?? -999),
    );
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
