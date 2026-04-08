import React, { useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { AppHeader } from './AppHeader';
import { TopTabBar } from './TopTabBar';
import { SignalLabScreen } from '../screens/SignalLabScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import {
  BLEScannerController,
  ScannerDataMode,
  WorkspaceTab,
} from '../utils/types';
import { colors, layout, spacing } from '../theme/tokens';

interface Props {
  controller: BLEScannerController;
  dataMode: ScannerDataMode;
  onChangeDataMode: (mode: ScannerDataMode) => void;
}

export function BLEWorkspace({
  controller,
  dataMode,
  onChangeDataMode,
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('scanner');
  const {
    devices,
    isScanning,
    statusMessage,
    bluetoothOff,
    startScanning,
    stopScanning,
    selectedDeviceId,
    setSelectedDeviceId,
  } = controller;

  useEffect(() => {
    if (dataMode === 'live' && bluetoothOff) {
      Alert.alert(
        'Bluetooth is off',
        'Turn Bluetooth back on before testing live beacon scans on a real device.'
      );
    }
  }, [bluetoothOff, dataMode]);

  const handleToggleScan = () => {
    if (isScanning) {
      stopScanning();
      return;
    }

    startScanning();
  };

  const openSignalLab = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setActiveTab('signalLab');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />

      <View style={styles.shell}>
        <AppHeader
          mode={dataMode}
          isScanning={isScanning}
          deviceCount={devices.length}
          statusMessage={statusMessage}
          onChangeMode={onChangeDataMode}
          onToggleScan={handleToggleScan}
        />

        <TopTabBar activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'scanner' ? (
          <ScannerScreen
            devices={devices}
            isScanning={isScanning}
            statusMessage={statusMessage}
            selectedDeviceId={selectedDeviceId}
            dataMode={dataMode}
            onToggleScan={handleToggleScan}
            onSelectDevice={setSelectedDeviceId}
            onOpenSignalLab={openSignalLab}
          />
        ) : (
          <SignalLabScreen
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            setSelectedDeviceId={setSelectedDeviceId}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.backgroundAccent,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: 40,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#F0E7D8',
  },
});
