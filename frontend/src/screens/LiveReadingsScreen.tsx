/**
 * ==========================================================================
 *   Tab 2 — Live Readings Screen
 * ==========================================================================
 *   Shows every BLE device the scanner sees, keyed by its UUID (device.id).
 *   Every named device is tracked with RSSI buffering, smoothing, and
 *   distance estimation. Devices whose names match the BEACONS config
 *   are highlighted as "known"; anything else is still shown so the
 *   user can discover beacons and then pick them on the Position tab.
 *
 *   Beacon config is defined in: frontend/src/config/beacons.ts
 *   Backend config is at:        backend/config.py
 * ==========================================================================
 */

import React, {useState, useEffect, useRef} from 'react';
import {View, Text, TouchableOpacity, ScrollView, StyleSheet} from 'react-native';
import {bleScanner, BeaconReading} from '../services/bleScanner';
import {rssiToDistance} from '../services/distance';
import {BEACONS, RSSI_D0, N} from '../config/beacons';

export default function LiveReadingsScreen() {
  const [readings, setReadings] = useState<Record<string, BeaconReading>>({});
  const [nearbyList, setNearbyList] = useState<BeaconReading[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showOnlyKnown, setShowOnlyKnown] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const toggleScanning = () => {
    if (scanning) {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      setScanning(false);
    } else {
      setScanning(true);
      unsubRef.current = bleScanner.subscribe((newReadings, nearby) => {
        setReadings({...newReadings});
        setNearbyList(nearby);
      });
    }
  };

  const devicesToShow = showOnlyKnown
    ? nearbyList.filter(d => d.name in BEACONS)
    : nearbyList;

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

      <TouchableOpacity
        style={styles.filterToggle}
        onPress={() => setShowOnlyKnown(v => !v)}>
        <Text style={styles.filterToggleText}>
          {showOnlyKnown
            ? 'Showing only known beacons — tap to show all'
            : 'Showing all detected devices — tap to show only known'}
        </Text>
      </TouchableOpacity>

      {devicesToShow.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {scanning
              ? 'No named BLE devices detected yet...'
              : 'Tap Start Scanning to discover beacons.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.beaconList}>
        {devicesToShow.map(device => {
          const beacon = readings[device.id] ?? device;
          const config = BEACONS[device.name];
          const active = beacon.active;
          const rawRssi = beacon.rawRssi;
          const smoothedRssi = beacon.smoothedRssi;

          let distance: number | null = null;
          if (smoothedRssi !== null && smoothedRssi !== undefined) {
            distance = rssiToDistance(smoothedRssi);
          }

          return (
            <View key={device.id} style={styles.beaconCard}>
              <View style={styles.beaconHeader}>
                <View style={{flex: 1}}>
                  <Text style={styles.beaconName}>{device.name}</Text>
                  <Text style={styles.beaconId}>{device.id}</Text>
                </View>
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
                    <Text style={styles.detailLabel}>Config position:</Text>
                    <Text style={styles.detailValueDim}>
                      ({config.x}, {config.y})
                    </Text>
                  </View>
                ) : (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Config position:</Text>
                    <Text style={styles.detailValueDim}>
                      custom (set in Position tab)
                    </Text>
                  </View>
                )}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Buffer:</Text>
                  <Text style={styles.detailValueDim}>
                    {beacon.rssiBuffer?.length ?? 0} / 5 samples
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
    marginBottom: 12,
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
  filterToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 16,
  },
  filterToggleText: {
    color: '#d29922',
    fontSize: 12,
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
    fontSize: 18,
    fontWeight: '700',
    color: '#e6edf3',
  },
  beaconId: {
    fontSize: 11,
    color: '#6e7681',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
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
});
