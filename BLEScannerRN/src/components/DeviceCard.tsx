/**
 * DeviceCard Component
 *
 * Displays a single BLE device as a styled card showing:
 *   - Signal strength icon with color-coded background
 *   - Ascending signal bars
 *   - Device name and ID (ESP32 badge if detected)
 *   - Raw RSSI and Kalman-filtered RSSI side by side
 *   - "Analyze" button to open the device in Kalman Test tab
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BLEDeviceInfo, getSignalStrength, getSignalBars, getSignalColor } from '../utils/types';
import { SignalStrengthBars } from './SignalStrengthBars';

interface Props {
  device: BLEDeviceInfo;
  isSelected: boolean;
  onSelect: () => void;
}

/** Returns true if the device name looks like an ESP32 beacon. */
function isESP32(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('esp32') || lower.includes('esp-32') || lower.includes('esp_32');
}

export const DeviceCard: React.FC<Props> = ({ device, isSelected, onSelect }) => {
  const strength = getSignalStrength(device.filteredRssi);
  const color = getSignalColor(strength);
  const bars = getSignalBars(device.filteredRssi);
  const esp32 = isESP32(device.name);

  return (
    <View
      style={[
        styles.card,
        { borderLeftColor: isSelected ? '#007AFF' : color },
        isSelected && styles.cardSelected,
      ]}
    >
      <View style={styles.row}>
        {/* ── Left column: signal icon + bars ── */}
        <View style={styles.signalContainer}>
          <View style={[styles.iconCircle, { backgroundColor: color + '30' }]}>
            <Text style={styles.iconText}>📡</Text>
          </View>
          <SignalStrengthBars bars={bars} color={color} />
        </View>

        {/* ── Right column: device info + RSSI values ── */}
        <View style={styles.infoContainer}>
          {/* Device name row with optional ESP32 badge */}
          <View style={styles.nameRow}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {device.name}
            </Text>
            {esp32 && (
              <View style={styles.esp32Badge}>
                <Text style={styles.esp32BadgeText}>ESP32</Text>
              </View>
            )}
          </View>

          {/* Device ID */}
          <Text style={styles.deviceId} numberOfLines={1}>
            {device.id}
          </Text>

          {/* Raw and Filtered RSSI */}
          <View style={styles.rssiRow}>
            <View style={styles.rssiBlock}>
              <Text style={styles.rssiLabel}>Raw RSSI</Text>
              <Text style={styles.rssiValue}>{device.rssi} dBm</Text>
            </View>
            <View style={styles.rssiBlock}>
              <Text style={styles.rssiLabel}>Filtered</Text>
              <Text style={[styles.rssiValue, { color }]}>
                {device.filteredRssi.toFixed(1)} dBm
              </Text>
            </View>
            <View style={styles.rssiBlock}>
              <Text style={styles.rssiLabel}>Samples</Text>
              <Text style={styles.rssiValue}>{device.rssiHistory.length}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Analyze button ── */}
      <TouchableOpacity
        style={[
          styles.analyzeButton,
          isSelected && styles.analyzeButtonSelected,
        ]}
        onPress={onSelect}
      >
        <Text
          style={[
            styles.analyzeButtonText,
            isSelected && styles.analyzeButtonTextSelected,
          ]}
        >
          {isSelected ? '✓ Analyzing in Kalman Test' : '📊 Analyze in Kalman Test'}
        </Text>
      </TouchableOpacity>
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
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  cardSelected: {
    shadowColor: '#007AFF',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
    flexShrink: 1,
  },
  esp32Badge: {
    backgroundColor: '#FF9F0A20',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#FF9F0A60',
  },
  esp32BadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF9F0A',
  },
  deviceId: {
    fontSize: 10,
    color: '#AEAEB2',
    marginBottom: 8,
  },
  rssiRow: {
    flexDirection: 'row',
    gap: 16,
  },
  rssiBlock: {
    gap: 1,
  },
  rssiLabel: {
    fontSize: 10,
    color: '#8E8E93',
  },
  rssiValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  // Analyze button
  analyzeButton: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#007AFF10',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF30',
  },
  analyzeButtonSelected: {
    backgroundColor: '#007AFF15',
    borderColor: '#007AFF',
  },
  analyzeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  analyzeButtonTextSelected: {
    color: '#007AFF',
  },
});
