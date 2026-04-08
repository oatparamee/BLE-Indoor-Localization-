/**
 * DeviceCard Component
 *
 * Displays a single BLE device as a styled card showing:
 *   - Signal strength icon with color-coded background
 *   - Ascending signal bars
 *   - Device name and ID
 *   - Raw RSSI and Kalman-filtered RSSI side by side
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BLEDeviceInfo, getSignalStrength, getSignalBars, getSignalColor } from '../utils/types';
import { SignalStrengthBars } from './SignalStrengthBars';

interface Props {
  device: BLEDeviceInfo;
}

export const DeviceCard: React.FC<Props> = ({ device }) => {
  // Determine signal category, color, and bar count from filtered RSSI.
  const strength = getSignalStrength(device.filteredRssi);
  const color = getSignalColor(strength);
  const bars = getSignalBars(device.filteredRssi);

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.row}>
        {/* ── Left column: signal icon + bars ── */}
        <View style={styles.signalContainer}>
          {/* Colored circle with antenna icon text */}
          <View style={[styles.iconCircle, { backgroundColor: color + '30' }]}>
            <Text style={[styles.iconText, { color }]}>📡</Text>
          </View>
          {/* Wi-Fi-style ascending bars */}
          <SignalStrengthBars bars={bars} color={color} />
        </View>

        {/* ── Right column: device info + RSSI values ── */}
        <View style={styles.infoContainer}>
          {/* Device name */}
          <Text style={styles.deviceName} numberOfLines={1}>
            {device.name}
          </Text>

          {/* Device ID (truncated for space) */}
          <Text style={styles.deviceId} numberOfLines={1}>
            ID: {device.id}
          </Text>

          {/* Raw and Filtered RSSI shown side by side */}
          <View style={styles.rssiRow}>
            {/* Raw RSSI — direct reading from BLE stack */}
            <View style={styles.rssiBlock}>
              <Text style={styles.rssiLabel}>Raw RSSI</Text>
              <Text style={styles.rssiValue}>{device.rssi} dBm</Text>
            </View>

            {/* Filtered RSSI — Kalman-smoothed value */}
            <View style={styles.rssiBlock}>
              <Text style={styles.rssiLabel}>Filtered RSSI</Text>
              <Text style={[styles.rssiValue, { color }]}>
                {device.filteredRssi.toFixed(1)} dBm
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 5,
    // Colored left border for quick visual scanning.
    borderLeftWidth: 4,
    // Shadow for card elevation.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signalContainer: {
    alignItems: 'center',
    marginRight: 12,
    gap: 6,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 20,
  },
  infoContainer: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 2,
  },
  deviceId: {
    fontSize: 11,
    color: '#8E8E93',
    marginBottom: 8,
  },
  rssiRow: {
    flexDirection: 'row',
    gap: 20,
  },
  rssiBlock: {
    gap: 2,
  },
  rssiLabel: {
    fontSize: 11,
    color: '#8E8E93',
  },
  rssiValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});
