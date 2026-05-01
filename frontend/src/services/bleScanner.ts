/**
 * BLE Scanner Service
 *
 * Scans ALL nearby BLE devices. Every device
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

import {BleManager, ScanMode, State} from 'react-native-ble-plx';
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
    if (Platform.OS !== 'android') return true;

    const apiLevel = Platform.Version;
    if (apiLevel >= 31) {
      // Android 12+: BLUETOOTH_SCAN is required to start a scan.
      // BLUETOOTH_CONNECT is only needed to connect to a GATT server, NOT
      // to scan, so we ask for it but don't fail if denied. ACCESS_FINE_LOCATION
      // is required when the manifest declares BLUETOOTH_SCAN without the
      // `neverForLocation` flag — request it just in case.
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      const scanGranted =
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED;
      const fineLocationGranted =
        results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;
      // Either path is enough on Android 12+: SCAN with neverForLocation,
      // OR the legacy combo of SCAN + FINE_LOCATION.
      return scanGranted || fineLocationGranted;
    }

    // Android < 12: only fine location is required for BLE scanning.
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
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
      console.warn(
        '[bleScanner] permissions not granted — scan will not start',
      );
      this.starting = false;
      return;
    }

    // Wait for Bluetooth to be powered on. nRF Connect does the same;
    // bailing on the very first state poll is what was breaking Android.
    const state = await this.manager.state();
    if (state !== State.PoweredOn) {
      console.warn(
        `[bleScanner] Bluetooth not on yet (state=${state}), waiting for PoweredOn...`,
      );
      const sub = this.manager.onStateChange(s => {
        if (s === State.PoweredOn) {
          sub.remove();
          this.starting = false;
          this._startUnderlyingScan().catch(err =>
            console.warn('[bleScanner] re-start failed:', err),
          );
        }
      }, true);
      this.starting = false;
      return;
    }

    this.scanning = true;
    this.starting = false;

    // Important Android settings:
    //   scanMode: LowLatency — same setting nRF Connect uses; far better at
    //     catching custom beacons in busy RF environments than the default
    //     LowPower mode (which silently drops a lot of advertisements).
    //   legacyScan defaults to true — leave it alone so we still pick up
    //     classic-format beacons. Setting it to false would BREAK detection
    //     of most BLE beacons on Android.
    this.manager.startDeviceScan(
      null,
      {allowDuplicates: true, scanMode: ScanMode.LowLatency},
      (error, device) => {
        if (error) {
          console.warn(
            `[bleScanner] scan error code=${error.errorCode} reason=${error.reason} message=${error.message}`,
          );
          return;
        }
        if (!device) return;
        if (device.rssi === null || device.rssi === undefined) return;

        // Detect ANY nearby BLE device. Keep a readable fallback label
        // for unnamed advertisements (Android often returns no name on
        // the first packet, then a name later).
        const rawName = device.name || device.localName;
        const trimmed = rawName?.trim();
        const displayName = trimmed || `Unknown-${device.id.slice(0, 8)}`;
        this._updateBeaconReading(device.id, displayName, device.rssi);
      },
    );

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
