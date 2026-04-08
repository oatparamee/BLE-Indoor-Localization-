import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScannerDataMode } from '../utils/types';
import { colors, radii, shadows, spacing, typography } from '../theme/tokens';

interface Props {
  mode: ScannerDataMode;
  isScanning: boolean;
  deviceCount: number;
  statusMessage: string;
  onChangeMode: (mode: ScannerDataMode) => void;
  onToggleScan: () => void;
}

const modeLabels: Record<ScannerDataMode, string> = {
  mock: 'Preview',
  live: 'Live BLE',
};

export function AppHeader({
  mode,
  isScanning,
  deviceCount,
  statusMessage,
  onChangeMode,
  onToggleScan,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Offline BLE Navigator</Text>

      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text style={styles.title}>Beacon Console</Text>
          <Text style={styles.subtitle}>
            Build the shared iOS and Android UI first, then flip over to live
            hardware testing when you are ready.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onToggleScan}
          style={[
            styles.scanButton,
            { backgroundColor: isScanning ? colors.danger : colors.accentStrong },
          ]}
        >
          <Text style={styles.scanButtonLabel}>
            {isScanning ? 'Pause' : mode === 'mock' ? 'Start preview' : 'Scan now'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.modeRow}>
        {(['mock', 'live'] as ScannerDataMode[]).map((nextMode) => {
          const active = nextMode === mode;
          return (
            <Pressable
              key={nextMode}
              accessibilityRole="button"
              onPress={() => onChangeMode(nextMode)}
              style={[styles.modeButton, active && styles.modeButtonActive]}
            >
              <Text
                style={[styles.modeButtonText, active && styles.modeButtonTextActive]}
              >
                {modeLabels[nextMode]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Source</Text>
          <Text style={styles.metricValue}>{modeLabels[mode]}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Visible</Text>
          <Text style={styles.metricValue}>{deviceCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>State</Text>
          <Text style={styles.metricValue}>{isScanning ? 'Running' : 'Paused'}</Text>
        </View>
      </View>

      <Text
        style={[
          styles.statusMessage,
          { color: isScanning ? colors.success : colors.textSecondary },
        ]}
      >
        {statusMessage}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows,
  },
  eyebrow: {
    fontSize: typography.eyebrow,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  titleRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  titleCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.hero,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  scanButton: {
    minWidth: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonLabel: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  modeButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: colors.accentStrong,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metricLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  metricValue: {
    fontSize: typography.section,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusMessage: {
    fontSize: typography.body,
    fontWeight: '600',
  },
});
