/**
 * ==========================================================================
 *   Tab 2 — Live Readings Screen
 * ==========================================================================
 *   Dynamically shows whatever beacons are detected via BLE.
 *   Any device whose name matches a key in the BEACONS config
 *   is shown as a beacon with RSSI, smoothed RSSI, and distance.
 *
 *   Also shows ALL nearby BLE devices so you can see what names
 *   your ESP32s are broadcasting and update the config to match.
 *
 *   Beacon config is defined in: frontend/src/config/beacons.ts
 *   Backend config is at:        backend/config.py
 * ==========================================================================
 */

import React, {useState, useEffect, useRef} from 'react';
import {View, Text, TouchableOpacity, ScrollView, StyleSheet} from 'react-native';
import {bleScanner, BeaconReading, NearbyDevice} from '../services/bleScanner';
import {rssiToDistance} from '../services/distance';
import {BEACONS, RSSI_D0, N} from '../config/beacons';

export default function LiveReadingsScreen() {
  const [readings, setReadings] = useState<Record<string, BeaconReading>>({});
  const [nearbyDevices, setNearbyDevices] = useState<NearbyDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const scanningRef = useRef(false);

  useEffect(() => {
    return () => {
      if (scanningRef.current) {
        bleScanner.stopScanning();
      }
    };
  }, []);

  const toggleScanning = async () => {
    if (scanning) {
      bleScanner.stopScanning();
      setScanning(false);
      scanningRef.current = false;
    } else {
      setScanning(true);
      scanningRef.current = true;
      await bleScanner.startScanning((newReadings, nearby) => {
        setReadings({...newReadings});
        setNearbyDevices(nearby);
      });
    }
  };

  const configuredBeacons = Object.keys(BEACONS);
  const detectedBeaconNames = Object.keys(readings).filter(
    name => name in BEACONS,
  );
  const beaconsToShow = [
    ...new Set([...configuredBeacons, ...detectedBeaconNames]),
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Live BLE Readings</Text>
      <Text style={styles.subtitle}>
        Real-time pipeline: RSSI → Smoothed → Distance
      </Text>

      <TouchableOpacity
        style={[styles.button, scanning ? styles.buttonStop : styles.buttonStart]}
        onPress={toggleScanning}>
        <Text style={styles.buttonText}>
          {scanning ? 'Stop Scanning' : 'Start Scanning'}
        </Text>
      </TouchableOpacity>

      {beaconsToShow.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No beacons configured. Add beacon names and positions in
            frontend/src/config/beacons.ts
          </Text>
        </View>
      ) : null}

      <View style={styles.beaconList}>
        {beaconsToShow.map(name => {
          const beacon = readings[name];
          const config = BEACONS[name];
          const active = beacon?.active ?? false;
          const rawRssi = beacon?.rawRssi;
          const smoothedRssi = beacon?.smoothedRssi;

          let distance: number | null = null;
          if (smoothedRssi !== null && smoothedRssi !== undefined) {
            distance = rssiToDistance(smoothedRssi);
          }

          return (
            <View key={name} style={styles.beaconCard}>
              <View style={styles.beaconHeader}>
                <Text style={styles.beaconName}>{name}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    active ? styles.statusActive : styles.statusLost,
                  ]}>
                  <Text
                    style={[
                      styles.statusText,
                      active ? styles.statusTextActive : styles.statusTextLost,
                    ]}>
                    {active ? 'ACTIVE' : 'LOST'}
                  </Text>
                </View>
              </View>

              <View style={styles.beaconDetails}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Raw RSSI:</Text>
                  <Text style={styles.detailValue}>
                    {rawRssi !== null && rawRssi !== undefined
                      ? `${rawRssi} dBm`
                      : '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Smoothed RSSI:</Text>
                  <Text style={styles.detailValue}>
                    {smoothedRssi !== null && smoothedRssi !== undefined
                      ? `${smoothedRssi.toFixed(1)} dBm`
                      : '—'}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Distance:</Text>
                  <Text style={[styles.detailValue, styles.distanceValue]}>
                    {distance !== null ? `${distance.toFixed(2)} m` : '—'}
                  </Text>
                </View>

                {config ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Position:</Text>
                    <Text style={styles.detailValueDim}>
                      ({config.x}, {config.y})
                    </Text>
                  </View>
                ) : null}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Buffer:</Text>
                  <Text style={styles.detailValueDim}>
                    {beacon?.rssiBuffer?.length ?? 0} / 5 samples
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Formula Parameters</Text>
        <Text style={styles.infoText}>
          d = 10 ^ ((RSSI_D0 - RSSI) / (10 × N))
        </Text>
        <Text style={styles.infoText}>RSSI_D0: {RSSI_D0} dBm</Text>
        <Text style={styles.infoText}>N: {N}</Text>
        <Text style={styles.infoNote}>
          Edit in: frontend/src/config/beacons.ts + backend/config.py
        </Text>
      </View>

      <TouchableOpacity
        style={styles.debugToggle}
        onPress={() => setShowNearby(!showNearby)}>
        <Text style={styles.debugToggleText}>
          {showNearby ? 'Hide' : 'Show'} All Nearby BLE Devices ({nearbyDevices.length})
        </Text>
      </TouchableOpacity>

      {showNearby ? (
        <View style={styles.nearbyBox}>
          <Text style={styles.nearbyTitle}>All Nearby BLE Devices</Text>
          <Text style={styles.nearbyHint}>
            Devices whose names match the BEACONS config are highlighted.
            If your ESP32 shows up with a different name, update the config
            to match or rename the ESP32.
          </Text>
          {nearbyDevices.length === 0 ? (
            <Text style={styles.nearbyEmpty}>
              {scanning ? 'No named BLE devices found nearby...' : 'Start scanning first'}
            </Text>
          ) : (
            nearbyDevices.map(dev => (
              <View
                key={dev.id}
                style={[
                  styles.nearbyRow,
                  dev.isConfigured && styles.nearbyRowMatch,
                ]}>
                <View style={styles.nearbyNameCol}>
                  <Text
                    style={[
                      styles.nearbyName,
                      dev.isConfigured && styles.nearbyNameMatch,
                    ]}>
                    {dev.name}
                  </Text>
                  <Text style={styles.nearbyId}>{dev.id.substring(0, 17)}</Text>
                </View>
                <Text style={styles.nearbyRssi}>
                  {dev.rssi ?? '?'} dBm
                </Text>
                {dev.isConfigured ? (
                  <Text style={styles.nearbyMatchBadge}>BEACON</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}

      <View style={{height: 40}} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    marginBottom: 16,
  },
  button: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonStart: {
    backgroundColor: '#238636',
  },
  buttonStop: {
    backgroundColor: '#da3633',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBox: {
    padding: 20,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 12,
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 14,
    textAlign: 'center',
  },
  beaconList: {
    gap: 12,
  },
  beaconCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  beaconHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  beaconName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e6edf3',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: '#0d2818',
    borderWidth: 1,
    borderColor: '#238636',
  },
  statusLost: {
    backgroundColor: '#3d1117',
    borderWidth: 1,
    borderColor: '#da3633',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusTextActive: {
    color: '#3fb950',
  },
  statusTextLost: {
    color: '#f85149',
  },
  beaconDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: '#8b949e',
  },
  detailValue: {
    fontSize: 14,
    color: '#e6edf3',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  distanceValue: {
    color: '#58a6ff',
    fontSize: 16,
  },
  detailValueDim: {
    fontSize: 14,
    color: '#6e7681',
    fontFamily: 'monospace',
  },
  infoBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#8b949e',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  infoNote: {
    fontSize: 12,
    color: '#6e7681',
    fontStyle: 'italic',
    marginTop: 8,
  },
  debugToggle: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#1c2128',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
  },
  debugToggleText: {
    color: '#d29922',
    fontSize: 14,
    fontWeight: '600',
  },
  nearbyBox: {
    marginTop: 12,
    padding: 16,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d29922',
  },
  nearbyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d29922',
    marginBottom: 4,
  },
  nearbyHint: {
    fontSize: 12,
    color: '#8b949e',
    marginBottom: 12,
  },
  nearbyEmpty: {
    fontSize: 13,
    color: '#6e7681',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  nearbyRowMatch: {
    backgroundColor: '#0d2818',
    borderRadius: 6,
    paddingHorizontal: 8,
    borderBottomColor: '#238636',
  },
  nearbyNameCol: {
    flex: 1,
  },
  nearbyName: {
    fontSize: 14,
    color: '#c9d1d9',
    fontFamily: 'monospace',
  },
  nearbyNameMatch: {
    color: '#3fb950',
    fontWeight: '700',
  },
  nearbyId: {
    fontSize: 10,
    color: '#6e7681',
    fontFamily: 'monospace',
  },
  nearbyRssi: {
    fontSize: 13,
    color: '#8b949e',
    fontFamily: 'monospace',
    width: 70,
    textAlign: 'right',
  },
  nearbyMatchBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3fb950',
    marginLeft: 8,
    backgroundColor: '#0d2818',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
