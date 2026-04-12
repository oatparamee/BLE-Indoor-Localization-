/**
 * ==========================================================================
 *   Tab 2 — Live Readings Screen
 * ==========================================================================
 *   Shows every step of the pipeline:
 *     Raw RSSI → Smoothed RSSI → Distance → Status
 *
 *   Beacon config is defined in: frontend/src/config/beacons.ts
 *   Backend config is at:        backend/config.py
 * ==========================================================================
 */

import React, {useState, useEffect, useRef} from 'react';
import {View, Text, TouchableOpacity, ScrollView, StyleSheet} from 'react-native';
import {bleScanner, BeaconReading} from '../services/bleScanner';
import {rssiToDistance} from '../services/distance';
import {BEACONS, BEACON_NAMES, N, N_DISTANCE} from '../config/beacons';

export default function LiveReadingsScreen() {
  const [readings, setReadings] = useState<Record<string, BeaconReading>>({});
  const [scanning, setScanning] = useState(false);
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
      await bleScanner.startScanning(newReadings => {
        setReadings({...newReadings});
      });
    }
  };

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

      <View style={styles.beaconList}>
        {BEACON_NAMES.map(name => {
          const beacon = readings[name];
          const config = BEACONS[name];
          const active = beacon?.active ?? false;
          const rawRssi = beacon?.rawRssi;
          const smoothedRssi = beacon?.smoothedRssi;

          let distance: number | null = null;
          if (smoothedRssi !== null && smoothedRssi !== undefined) {
            distance = rssiToDistance(smoothedRssi, config.txPower);
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

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Position:</Text>
                  <Text style={styles.detailValueDim}>
                    ({config.x}, {config.y})
                  </Text>
                </View>

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
        <Text style={styles.infoTitle}>Configuration</Text>
        <Text style={styles.infoText}>
          txPower: {BEACONS[BEACON_NAMES[0]].txPower} dBm (per beacon)
        </Text>
        <Text style={styles.infoText}>
          N (path loss exponent): {N_DISTANCE}
        </Text>
        <Text style={styles.infoText}>
          N (environment): {N}
        </Text>
        <Text style={styles.infoNote}>
          Edit values in: frontend/src/config/beacons.ts
        </Text>
      </View>
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
    marginBottom: 40,
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
});
