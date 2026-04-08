import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BeaconCard } from '../components/BeaconCard';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { BLEDeviceInfo, ScannerDataMode } from '../utils/types';

interface Props {
  devices: BLEDeviceInfo[];
  isScanning: boolean;
  statusMessage: string;
  selectedDeviceId: string | null;
  dataMode: ScannerDataMode;
  onToggleScan: () => void;
  onSelectDevice: (id: string | null) => void;
  onOpenSignalLab: (id: string) => void;
}

function OverviewChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.overviewChip}>
      <Text style={styles.overviewLabel}>{label}</Text>
      <Text style={styles.overviewValue}>{value}</Text>
    </View>
  );
}

export function ScannerScreen({
  devices,
  isScanning,
  statusMessage,
  selectedDeviceId,
  dataMode,
  onToggleScan,
  onSelectDevice,
  onOpenSignalLab,
}: Props) {
  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ?? null;
  const strongestDevice = devices[0] ?? null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Text style={styles.sectionEyebrow}>Scanner Deck</Text>
        <Text style={styles.heroTitle}>
          {dataMode === 'mock'
            ? 'Preview the cross-platform flow before hardware testing'
            : 'Watch nearby beacons update in real time'}
        </Text>
        <Text style={styles.heroBody}>
          {dataMode === 'mock'
            ? 'Use the preview feed to shape cards, spacing, and navigation without waiting on a real BLE session.'
            : 'This view is ready for physical-device runs once you move from simulator work to live beacon checks.'}
        </Text>

        <View style={styles.overviewRow}>
          <OverviewChip label="Visible" value={`${devices.length}`} />
          <OverviewChip
            label="Strongest"
            value={strongestDevice ? strongestDevice.name : 'Waiting'}
          />
          <OverviewChip
            label="Pinned"
            value={selectedDevice ? selectedDevice.name : 'None'}
          />
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusMessage}>{statusMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleScan}
            style={styles.heroAction}
          >
            <Text style={styles.heroActionText}>
              {isScanning
                ? dataMode === 'mock'
                  ? 'Pause feed'
                  : 'Stop scan'
                : dataMode === 'mock'
                  ? 'Resume feed'
                  : 'Start scan'}
            </Text>
          </Pressable>
        </View>
      </View>

      {devices.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No beacons on deck yet</Text>
          <Text style={styles.emptyBody}>
            {dataMode === 'mock'
              ? 'Start the preview feed to populate realistic cards, then tune the layout and interaction details from there.'
              : 'Run a live scan on a physical device when you are ready to verify the production layout against real BLE traffic.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleScan}
            style={styles.emptyAction}
          >
            <Text style={styles.emptyActionText}>
              {dataMode === 'mock' ? 'Start preview data' : 'Start live scan'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nearby Beacons</Text>
            <Text style={styles.sectionMeta}>{devices.length} cards active</Text>
          </View>

          <View style={styles.cardStack}>
            {devices.map((device) => {
              const isSelected = device.id === selectedDeviceId;

              return (
                <BeaconCard
                  key={device.id}
                  device={device}
                  isSelected={isSelected}
                  onSelect={() => onSelectDevice(isSelected ? null : device.id)}
                  onAnalyze={() => onOpenSignalLab(device.id)}
                />
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: typography.eyebrow,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.sand,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.surface,
  },
  heroBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: '#D7E0EA',
  },
  overviewRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  overviewChip: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  overviewLabel: {
    fontSize: typography.caption,
    color: '#A8B4C1',
  },
  overviewValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusMessage: {
    flex: 1,
    fontSize: typography.body,
    color: colors.sand,
  },
  heroAction: {
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  heroActionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  emptyTitle: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  emptyAction: {
    borderRadius: radii.pill,
    backgroundColor: colors.accentStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyActionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionMeta: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  cardStack: {
    gap: spacing.md,
  },
});
