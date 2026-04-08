/**
 * BLE Scanner — Main App Component
 *
 * The root screen of the application. Renders:
 *   - A status header with a scanning indicator and device count
 *   - A scan toggle button in the header
 *   - A scrollable list of BLE device cards (or an empty state)
 *   - An alert when Bluetooth is turned off
 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
} from 'react-native';
import { useBLEScanner } from './src/hooks/useBLEScanner';
import { DeviceCard } from './src/components/DeviceCard';
import { BLEDeviceInfo } from './src/utils/types';

export default function App() {
  const {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff,
    startScanning,
    stopScanning,
  } = useBLEScanner();

  // Show an alert when Bluetooth is detected as powered off.
  React.useEffect(() => {
    if (bluetoothOff) {
      Alert.alert(
        'Bluetooth is Turned Off',
        'Please enable Bluetooth in Settings to scan for nearby BLE devices.',
        [{ text: 'OK' }]
      );
    }
  }, [bluetoothOff]);

  /** Toggle scanning on/off. */
  const handleToggleScan = () => {
    if (isScanning) {
      stopScanning();
    } else {
      startScanning();
    }
  };

  /** Renders a single device card in the FlatList. */
  const renderDevice = ({ item }: { item: BLEDeviceInfo }) => (
    <DeviceCard device={item} />
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F2F2F7" />

      {/* ── Navigation Bar ── */}
      <View style={styles.navbar}>
        <Text style={styles.title}>BLE Scanner</Text>
        {/* Scan toggle button (play / stop) */}
        <TouchableOpacity onPress={handleToggleScan} style={styles.toggleButton}>
          <Text style={styles.toggleButtonText}>
            {isScanning ? '⏹ Stop' : '▶️ Scan'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Status Header ── */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          {/* Pulsing dot: green when scanning, red when stopped */}
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isScanning ? '#34C759' : '#FF3B30' },
            ]}
          />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
        {/* Device count badge */}
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{devices.length} devices</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* ── Device List or Empty State ── */}
      {devices.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No BLE Devices Found</Text>
          <Text style={styles.emptySubtitle}>
            Make sure Bluetooth is enabled and{'\n'}BLE devices are nearby.
          </Text>
          {!isScanning && (
            <TouchableOpacity style={styles.scanButton} onPress={startScanning}>
              <Text style={styles.scanButtonText}>Start Scanning</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={renderDevice}
          contentContainerStyle={styles.listContent}
          // Pull-to-refresh restarts the scan.
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  navbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  toggleButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#007AFF15',
  },
  toggleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 13,
    color: '#8E8E93',
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#007AFF15',
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  listContent: {
    paddingTop: 10,
    paddingBottom: 20,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  scanButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    backgroundColor: '#007AFF',
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
