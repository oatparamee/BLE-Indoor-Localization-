import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BLEDeviceInfo,
  getSignalBars,
  getSignalColor,
  getSignalStrength,
} from '../utils/types';
import { SignalStrengthBars } from './SignalStrengthBars';
import { colors, radii, shadows, spacing, typography } from '../theme/tokens';

interface Props {
  device: BLEDeviceInfo;
  isSelected: boolean;
  onSelect: () => void;
  onAnalyze: () => void;
}

const signalCopy = {
  strong: 'Near',
  medium: 'Stable',
  weak: 'Faint',
} as const;

function looksLikeEsp32(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('esp32') || normalized.includes('esp-32');
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function BeaconCard({ device, isSelected, onSelect, onAnalyze }: Props) {
  const strength = getSignalStrength(device.filteredRssi);
  const color = getSignalColor(strength);
  const bars = getSignalBars(device.filteredRssi);
  const esp32 = looksLikeEsp32(device.name);

  return (
    <View style={[styles.card, isSelected && styles.cardSelected]}>
      <View style={styles.topRow}>
        <View style={styles.nameGroup}>
          <Text style={styles.name}>{device.name}</Text>
          <View style={[styles.signalBadge, { backgroundColor: `${color}18` }]}>
            <Text style={[styles.signalBadgeText, { color }]}>
              {signalCopy[strength]}
            </Text>
          </View>
          {esp32 && (
            <View style={styles.esp32Badge}>
              <Text style={styles.esp32BadgeText}>ESP32</Text>
            </View>
          )}
        </View>

        <View style={[styles.rssiPill, { borderColor: `${color}33` }]}>
          <Text style={[styles.rssiPillText, { color }]}>
            {device.filteredRssi.toFixed(1)} dBm
          </Text>
        </View>
      </View>

      <Text style={styles.deviceId}>{device.id}</Text>

      <View style={styles.signalRow}>
        <SignalStrengthBars bars={bars} color={color} />
        <Text style={styles.signalHint}>
          {isSelected
            ? 'Pinned for tuning in Signal Lab'
            : 'Pin this beacon to keep it in focus while you design'}
        </Text>
      </View>

      <View style={styles.metricRow}>
        <Metric label="Raw" value={`${device.rssi.toFixed(0)} dBm`} />
        <Metric label="Filtered" value={`${device.filteredRssi.toFixed(1)} dBm`} />
        <Metric label="Samples" value={`${device.rssiHistory.length}`} />
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onSelect}
          style={[styles.secondaryAction, isSelected && styles.secondaryActionActive]}
        >
          <Text
            style={[
              styles.secondaryActionText,
              isSelected && styles.secondaryActionTextActive,
            ]}
          >
            {isSelected ? 'Pinned' : 'Pin for lab'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onAnalyze}
          style={styles.primaryAction}
        >
          <Text style={styles.primaryActionText}>Open Signal Lab</Text>
        </Pressable>
      </View>
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
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: '#FCFEFE',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  nameGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  signalBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  signalBadgeText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  esp32Badge: {
    backgroundColor: `${colors.warning}15`,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  esp32BadgeText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.warning,
  },
  rssiPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    backgroundColor: colors.surfaceMuted,
  },
  rssiPillText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  deviceId: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  signalHint: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  metricLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  metricValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  secondaryActionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  secondaryActionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  secondaryActionTextActive: {
    color: colors.accentStrong,
  },
  primaryAction: {
    flex: 1.3,
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  primaryActionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
});
