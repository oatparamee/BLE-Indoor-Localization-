import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KalmanFilter } from '../utils/KalmanFilter';
import {
  BLEDeviceInfo,
  getSignalColor,
  getSignalStrength,
} from '../utils/types';
import { colors, radii, shadows, spacing, typography } from '../theme/tokens';

const RSSI_MIN = -100;
const RSSI_MAX = -30;
const CHART_HEIGHT = 160;

interface Props {
  devices: BLEDeviceInfo[];
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
}

function normalizeRssi(rssi: number): number {
  const clamped = Math.max(RSSI_MIN, Math.min(RSSI_MAX, rssi));
  return (clamped - RSSI_MIN) / (RSSI_MAX - RSSI_MIN);
}

function applyKalman(rawHistory: number[], q: number, r: number): number[] {
  if (rawHistory.length === 0) {
    return [];
  }

  const filter = new KalmanFilter(q, r, 1.0);
  return rawHistory.map((value) => filter.update(value));
}

function StatTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
    </View>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  decimals,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  decimals: number;
  onChange: (next: number) => void;
}) {
  const decrement = () =>
    onChange(Math.max(min, Number((value - step).toFixed(decimals))));
  const increment = () =>
    onChange(Math.min(max, Number((value + step).toFixed(decimals))));

  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityRole="button"
          onPress={decrement}
          style={styles.stepperButton}
        >
          <Text style={styles.stepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value.toFixed(decimals)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={increment}
          style={styles.stepperButton}
        >
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function SignalLabScreen({
  devices,
  selectedDeviceId,
  setSelectedDeviceId,
}: Props) {
  const [q, setQ] = useState(0.1);
  const [r, setR] = useState(1.0);

  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null;

  const rawHistory = selectedDevice?.rssiHistory ?? [];
  const filteredHistory = useMemo(() => {
    if (!selectedDevice) {
      return [];
    }

    return applyKalman(selectedDevice.rssiHistory, q, r);
  }, [selectedDevice, q, r]);

  const stats = useMemo(() => {
    if (rawHistory.length === 0) {
      return null;
    }

    const rawAverage = rawHistory.reduce((sum, value) => sum + value, 0) / rawHistory.length;
    const filteredAverage =
      filteredHistory.reduce((sum, value) => sum + value, 0) / filteredHistory.length;

    const rawVariance =
      rawHistory.reduce((sum, value) => sum + (value - rawAverage) ** 2, 0) /
      rawHistory.length;
    const filteredVariance =
      filteredHistory.reduce((sum, value) => sum + (value - filteredAverage) ** 2, 0) /
      filteredHistory.length;

    return {
      rawAverage: rawAverage.toFixed(1),
      filteredAverage: filteredAverage.toFixed(1),
      rawStdDev: Math.sqrt(rawVariance).toFixed(2),
      filteredStdDev: Math.sqrt(filteredVariance).toFixed(2),
      samples: rawHistory.length,
    };
  }, [filteredHistory, rawHistory]);

  const signalColor = selectedDevice
    ? getSignalColor(getSignalStrength(selectedDevice.filteredRssi))
    : colors.textMuted;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Text style={styles.sectionEyebrow}>Signal Lab</Text>
        <Text style={styles.heroTitle}>
          {selectedDevice ? selectedDevice.name : 'Pick a beacon to inspect'}
        </Text>
        <Text style={styles.heroBody}>
          {selectedDevice
            ? selectedDeviceId
              ? 'This pinned device stays in focus while you tune filter behavior and chart styling.'
              : 'The strongest beacon is shown by default until you pin a different one from the Scanner.'
            : 'Use preview data in the Scanner tab to populate this workspace before you refine the tuning UI.'}
        </Text>

        {selectedDevice && (
          <View style={styles.heroMetrics}>
            <StatTile label="Filtered" value={`${selectedDevice.filteredRssi.toFixed(1)} dBm`} accent />
            <StatTile label="Samples" value={`${selectedDevice.rssiHistory.length}`} />
            <StatTile label="Signal" value={getSignalStrength(selectedDevice.filteredRssi)} />
          </View>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Focus Beacon</Text>
        {devices.length === 0 ? (
          <Text style={styles.sectionEmpty}>
            No devices are available yet. Start the preview feed from Scanner to
            populate this lab.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.deviceChipRow}
          >
            {devices.map((device) => {
              const active = selectedDevice?.id === device.id;

              return (
                <Pressable
                  key={device.id}
                  accessibilityRole="button"
                  onPress={() =>
                    setSelectedDeviceId(device.id === selectedDeviceId ? null : device.id)
                  }
                  style={[styles.deviceChip, active && styles.deviceChipActive]}
                >
                  <View
                    style={[
                      styles.deviceChipDot,
                      {
                        backgroundColor: getSignalColor(
                          getSignalStrength(device.filteredRssi)
                        ),
                      },
                    ]}
                  />
                  <Text
                    style={[styles.deviceChipText, active && styles.deviceChipTextActive]}
                  >
                    {device.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Filter Tuning</Text>
        <Text style={styles.sectionBody}>
          Use these controls as UI placeholders now. Later, the same layout can
          drive real tuning or calibration tools.
        </Text>

        <View style={styles.stepperStack}>
          <Stepper
            label="Q - Process Noise"
            value={q}
            step={0.05}
            min={0.01}
            max={5}
            decimals={2}
            onChange={setQ}
          />
          <Stepper
            label="R - Measurement Noise"
            value={r}
            step={0.5}
            min={0.1}
            max={20}
            decimals={1}
            onChange={setR}
          />
        </View>

        <View style={styles.explainerCard}>
          <Text style={styles.explainerText}>
            Lower Q keeps the line smoother. Higher Q reacts faster. Lower R
            trusts raw readings more. Higher R dampens short spikes.
          </Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>RSSI History</Text>
        <Text style={styles.sectionBody}>
          Gray bars show raw samples and the colored bars show the re-filtered
          version of the same history.
        </Text>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.textMuted }]} />
            <Text style={styles.legendText}>Raw</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: signalColor }]} />
            <Text style={styles.legendText}>Filtered</Text>
          </View>
        </View>

        {selectedDevice ? (
          <View style={styles.chartShell}>
            <View style={styles.yAxis}>
              <Text style={styles.axisLabel}>{RSSI_MAX}</Text>
              <Text style={styles.axisLabel}>{Math.round((RSSI_MAX + RSSI_MIN) / 2)}</Text>
              <Text style={styles.axisLabel}>{RSSI_MIN}</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chartScroll}
            >
              <View style={styles.chartArea}>
                <View style={[styles.gridLine, { top: 0 }]} />
                <View style={[styles.gridLine, { top: CHART_HEIGHT / 2 }]} />
                <View style={[styles.gridLine, { top: CHART_HEIGHT - 1 }]} />

                <View style={styles.barRow}>
                  {rawHistory.map((raw, index) => {
                    const filtered = filteredHistory[index] ?? raw;
                    const rawHeight = Math.max(
                      8,
                      Math.round(normalizeRssi(raw) * CHART_HEIGHT)
                    );
                    const filteredHeight = Math.max(
                      8,
                      Math.round(normalizeRssi(filtered) * CHART_HEIGHT)
                    );

                    return (
                      <View key={`${selectedDevice.id}-${index}`} style={styles.barGroup}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: rawHeight,
                              backgroundColor: colors.textMuted,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.bar,
                            {
                              height: filteredHeight,
                              backgroundColor: signalColor,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
          </View>
        ) : (
          <Text style={styles.sectionEmpty}>Select a device to see chart data.</Text>
        )}
      </View>

      {stats && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Signal Summary</Text>
          <View style={styles.statsGrid}>
            <StatTile label="Raw avg" value={`${stats.rawAverage} dBm`} />
            <StatTile
              label="Filtered avg"
              value={`${stats.filteredAverage} dBm`}
              accent
            />
            <StatTile label="Raw std dev" value={`${stats.rawStdDev} dBm`} />
            <StatTile
              label="Filtered std dev"
              value={`${stats.filteredStdDev} dBm`}
              accent
            />
          </View>
          <Text style={styles.summaryHint}>
            Lower filtered deviation means the UI is showing a steadier signal
            than the raw feed.
          </Text>
        </View>
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
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows,
  },
  sectionEyebrow: {
    fontSize: typography.eyebrow,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  heroBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  heroMetrics: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows,
  },
  sectionTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  sectionEmpty: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textMuted,
  },
  deviceChipRow: {
    gap: spacing.sm,
  },
  deviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  deviceChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  deviceChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceChipText: {
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  deviceChipTextActive: {
    color: colors.accentStrong,
  },
  stepperStack: {
    gap: spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stepperLabel: {
    flex: 1,
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  stepperButtonText: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.accentStrong,
  },
  stepperValue: {
    minWidth: 56,
    textAlign: 'center',
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  explainerCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  explainerText: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  chartShell: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  yAxis: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    paddingVertical: 2,
  },
  axisLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  chartScroll: {
    flex: 1,
  },
  chartArea: {
    height: CHART_HEIGHT,
    minWidth: 420,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    justifyContent: 'flex-end',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: CHART_HEIGHT,
  },
  barGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    width: 8,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statTile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  statLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  statValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueAccent: {
    color: colors.accentStrong,
  },
  summaryHint: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
