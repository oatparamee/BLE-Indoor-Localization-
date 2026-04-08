/**
 * BLE Scanner — Main App Component
 *
 * Two-tab layout:
 *   Tab 1 "Scanner"  — live BLE device list with RSSI
 *   Tab 2 "Kalman"   — Kalman filter test screen with adjustable params and chart
 */

import React, { useState } from 'react';
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
import { KalmanTestScreen } from './src/screens/KalmanTestScreen';
import { BLEDeviceInfo } from './src/utils/types';

type Tab = 'scanner' | 'kalman';

export default function App() {
  const {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff,
    startScanning,
    stopScanning,
    selectedDeviceId,
    setSelectedDeviceId,
  } = useBLEScanner();

  const [activeTab, setActiveTab] = useState<Tab>('scanner');

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

  const handleToggleScan = () => {
    if (isScanning) {
      stopScanning();
    } else {
      startScanning();
    }
  };

  const renderDevice = ({ item }: { item: BLEDeviceInfo }) => (
    <DeviceCard
      device={item}
      isSelected={item.id === selectedDeviceId}
      onSelect={() => {
        setSelectedDeviceId(item.id === selectedDeviceId ? null : item.id);
        setActiveTab('kalman');
      }}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F2F2F7" />

      {/* ── Navigation Bar ── */}
      <View style={styles.navbar}>
        <View>
          <Text style={styles.title}>BLE Scanner</Text>
          <Text style={styles.subtitle}>ESP32 & BLE Beacon Detector</Text>
        </View>
        {/* Scan toggle button — prominent pill */}
        <TouchableOpacity
          onPress={handleToggleScan}
          style={[
            styles.toggleButton,
            { backgroundColor: isScanning ? '#FF3B3015' : '#34C75920' },
          ]}
        >
          <View
            style={[
              styles.toggleDot,
              { backgroundColor: isScanning ? '#FF3B30' : '#34C759' },
            ]}
          />
          <Text
            style={[
              styles.toggleButtonText,
              { color: isScanning ? '#FF3B30' : '#34C759' },
            ]}
          >
            {isScanning ? 'Stop' : 'Scan'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Status Bar ── */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isScanning ? '#34C759' : '#FF3B30' },
            ]}
          />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{devices.length} device{devices.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* ── Tab Bar ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'scanner' && styles.tabActive]}
          onPress={() => setActiveTab('scanner')}
        >
          <Text style={[styles.tabIcon]}>📡</Text>
          <Text
            style={[styles.tabLabel, activeTab === 'scanner' && styles.tabLabelActive]}
          >
            Scanner
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'kalman' && styles.tabActive]}
          onPress={() => setActiveTab('kalman')}
        >
          <Text style={styles.tabIcon}>📊</Text>
          <Text
            style={[styles.tabLabel, activeTab === 'kalman' && styles.tabLabelActive]}
          >
            Kalman Test
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {/* ── Tab Content ── */}
      {activeTab === 'scanner' ? (
        <>
          {devices.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyTitle}>No BLE Devices Found</Text>
              <Text style={styles.emptySubtitle}>
                Make sure Bluetooth is enabled and{'\n'}your ESP32 or other BLE beacon is nearby.
              </Text>
              {!isScanning && (
                <TouchableOpacity style={styles.scanButton} onPress={startScanning}>
                  <Text style={styles.scanButtonText}>▶  Start Scanning</Text>
                </TouchableOpacity>
              )}
              {isScanning && (
                <View style={styles.scanningIndicator}>
                  <View style={styles.scanningDot} />
                  <Text style={styles.scanningText}>Scanning for devices...</Text>
                </View>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.listHint}>
                Tap a device card to analyze it in the Kalman Test tab
              </Text>
              <FlatList
                data={devices}
                keyExtractor={(item) => item.id}
                renderItem={renderDevice}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            </>
          )}
        </>
      ) : (
        <KalmanTestScreen
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          setSelectedDeviceId={setSelectedDeviceId}
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
  // Navbar
  navbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  subtitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    gap: 8,
  },
  toggleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toggleButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  // Status bar
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  // Tab bar (top)
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: '#007AFF12',
  },
  tabIcon: {
    fontSize: 16,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
  },
  tabLabelActive: {
    color: '#007AFF',
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  // Scanner empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#3C3C43',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  scanButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  scanButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  scanningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  scanningText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '500',
  },
  // Device list
  listHint: {
    fontSize: 12,
    color: '#AEAEB2',
    textAlign: 'center',
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 20,
  },
});
