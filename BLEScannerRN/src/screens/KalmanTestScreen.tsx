/**
 * KalmanTestScreen
 *
 * Lets you pick any discovered BLE device and visualize its raw vs
 * Kalman-filtered RSSI history in real time. You can also tweak the
 * filter's Q (process noise) and R (measurement noise) parameters and
 * see the effect immediately by re-running the filter over stored history.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { BLEDeviceInfo, getSignalStrength, getSignalColor } from '../utils/types';
import { KalmanFilter } from '../utils/KalmanFilter';

interface Props {
  devices: BLEDeviceInfo[];
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
}

// Chart display range: anything outside this is clamped.
const RSSI_MIN = -100;
const RSSI_MAX = -30;
const CHART_HEIGHT = 140;

/** Normalize an RSSI value to a 0-1 fraction within [RSSI_MIN, RSSI_MAX]. */
function normalizeRssi(rssi: number): number {
  const clamped = Math.max(RSSI_MIN, Math.min(RSSI_MAX, rssi));
  return (clamped - RSSI_MIN) / (RSSI_MAX - RSSI_MIN);
}

/** Re-apply a Kalman filter over an array of raw readings. */
function applyKalman(rawHistory: number[], q: number, r: number): number[] {
  if (rawHistory.length === 0) return [];
  const filter = new KalmanFilter(q, r, 1.0);
  return rawHistory.map((v) => filter.update(v));
}

/** Deterministic pseudo-random in [0, 1) for repeatable synthetic data. */
function seededUnit(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Builds a fixed-length noisy RSSI series (dBm) for offline Kalman testing.
 * True signal drifts slowly; measurements add jitter — same inputs every time.
 */
function generateSyntheticRssiHistory(length = 30): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const trend = -62 + 7 * Math.sin(i / 3.2);
    const noise = (seededUnit(i) - 0.5) * 14;
    out.push(Math.round(trend + noise));
  }
  return out;
}

/** Simple +/− stepper for numeric parameters. */
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
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(Math.max(min, parseFloat((value - step).toFixed(decimals))));
  const inc = () => onChange(Math.min(max, parseFloat((value + step).toFixed(decimals))));

  return (
    <View style={stepperStyles.row}>
      <Text style={stepperStyles.label}>{label}</Text>
      <TouchableOpacity onPress={dec} style={stepperStyles.btn}>
        <Text style={stepperStyles.btnText}>−</Text>
      </TouchableOpacity>
      <Text style={stepperStyles.value}>{value.toFixed(decimals)}</Text>
      <TouchableOpacity onPress={inc} style={stepperStyles.btn}>
        <Text style={stepperStyles.btnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    width: 130,
    fontSize: 13,
    color: '#3C3C43',
  },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    fontSize: 20,
    color: '#007AFF',
    lineHeight: 24,
  },
  value: {
    width: 44,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});

// ── Main screen ────────────────────────────────────────────────────

export function KalmanTestScreen({ devices, selectedDeviceId, setSelectedDeviceId }: Props) {
  const [q, setQ] = useState(0.1);
  const [r, setR] = useState(1.0);
  /** When set, chart and stats use this instead of a discovered device (offline Kalman test). */
  const [syntheticRawHistory, setSyntheticRawHistory] = useState<number[] | null>(null);

  const selected = devices.find((d) => d.id === selectedDeviceId) ?? null;

  const rawHistory = syntheticRawHistory ?? selected?.rssiHistory ?? [];

  // Re-compute filtered history whenever raw history or params change.
  const reFilteredHistory = useMemo(() => {
    if (rawHistory.length === 0) return [];
    return applyKalman(rawHistory, q, r);
  }, [rawHistory, q, r]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - 48; // padding
  const barWidth = Math.max(4, Math.floor((chartWidth - 2) / 30) - 2);

  // Stats derived from history
  const stats = useMemo(() => {
    if (rawHistory.length === 0) return null;
    const rawAvg = rawHistory.reduce((s, v) => s + v, 0) / rawHistory.length;
    const filtAvg =
      reFilteredHistory.reduce((s, v) => s + v, 0) / reFilteredHistory.length;
    const rawVar =
      rawHistory.reduce((s, v) => s + (v - rawAvg) ** 2, 0) / rawHistory.length;
    const filtVar =
      reFilteredHistory.reduce((s, v) => s + (v - filtAvg) ** 2, 0) /
      reFilteredHistory.length;
    return {
      rawAvg: rawAvg.toFixed(1),
      filtAvg: filtAvg.toFixed(1),
      rawStdDev: Math.sqrt(rawVar).toFixed(2),
      filtStdDev: Math.sqrt(filtVar).toFixed(2),
      samples: rawHistory.length,
    };
  }, [rawHistory, reFilteredHistory]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Synthetic Kalman demo (no BLE required) ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kalman filter — synthetic demo</Text>
        <Text style={styles.paramHint}>
          Test the same 1D Kalman logic as live RSSI without scanning. Data is deterministic so you
          can compare runs.
        </Text>
        <View style={styles.syntheticButtons}>
          <TouchableOpacity
            style={styles.syntheticPrimary}
            onPress={() => {
              setSelectedDeviceId(null);
              setSyntheticRawHistory(generateSyntheticRssiHistory(30));
            }}
          >
            <Text style={styles.syntheticPrimaryText}>Load synthetic noisy RSSI</Text>
          </TouchableOpacity>
          {syntheticRawHistory && (
            <TouchableOpacity
              style={styles.syntheticSecondary}
              onPress={() => setSyntheticRawHistory(null)}
            >
              <Text style={styles.syntheticSecondaryText}>Clear demo — use device list below</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.expectedBox}>
          <Text style={styles.expectedTitle}>Expected output</Text>
          <Text style={styles.expectedBody}>
            The <Text style={styles.bold}>blue (filtered)</Text> bars should follow the same overall
            trend as <Text style={styles.bold}>gray (raw)</Text> but with smaller up/down swings. With
            default Q and R, <Text style={styles.bold}>Filtered Std Dev</Text> should be lower than{' '}
            <Text style={styles.bold}>Raw Std Dev</Text>. Raising R smooths more; raising Q tracks
            faster.
          </Text>
        </View>
      </View>

      {/* ── Section: Device Selector ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Select Device to Analyze</Text>
        {syntheticRawHistory && (
          <View style={styles.syntheticBanner}>
            <Text style={styles.syntheticBannerText}>
              Showing synthetic demo — pick a device to switch to live RSSI history.
            </Text>
          </View>
        )}
        {devices.length === 0 ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>
              No devices discovered yet.{'\n'}Go to the Scanner tab and start scanning.
            </Text>
          </View>
        ) : (
          devices.map((d) => {
            const active = d.id === selectedDeviceId;
            const strength = getSignalStrength(d.filteredRssi);
            const color = getSignalColor(strength);
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.deviceRow, active && styles.deviceRowActive]}
                onPress={() => {
                  setSyntheticRawHistory(null);
                  setSelectedDeviceId(active ? null : d.id);
                }}
              >
                <View style={[styles.deviceDot, { backgroundColor: color }]} />
                <View style={styles.deviceRowInfo}>
                  <Text style={styles.deviceRowName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.deviceRowId} numberOfLines={1}>
                    {d.id}
                  </Text>
                </View>
                <Text style={[styles.deviceRowRssi, { color }]}>
                  {d.filteredRssi.toFixed(1)} dBm
                </Text>
                {active && <Text style={styles.checkmark}> ✓</Text>}
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* ── Section: Filter Parameters ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kalman Filter Parameters</Text>
        <Text style={styles.paramHint}>
          Adjust Q and R to see how the filter responds in the chart below.
        </Text>
        <View style={styles.steppers}>
          <Stepper
            label="Q — Process Noise"
            value={q}
            step={0.05}
            min={0.01}
            max={5.0}
            decimals={2}
            onChange={setQ}
          />
          <View style={styles.stepperDivider} />
          <Stepper
            label="R — Measurement Noise"
            value={r}
            step={0.5}
            min={0.1}
            max={20.0}
            decimals={1}
            onChange={setR}
          />
        </View>
        <View style={styles.paramExplain}>
          <Text style={styles.paramExplainText}>
            <Text style={styles.bold}>Low Q</Text> → trusts its own prediction more (smoother, slower to react){'\n'}
            <Text style={styles.bold}>High Q</Text> → adapts faster to changes (noisier){'\n'}
            <Text style={styles.bold}>Low R</Text> → trusts measurements more (faster, noisier){'\n'}
            <Text style={styles.bold}>High R</Text> → heavily smooths measurements (laggy)
          </Text>
        </View>
      </View>

      {/* ── Section: RSSI Chart ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          RSSI History
          {syntheticRawHistory
            ? ' — Synthetic demo'
            : selected
              ? ` — ${selected.name}`
              : ''}
        </Text>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#8E8E93' }]} />
            <Text style={styles.legendText}>Raw RSSI</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#007AFF' }]} />
            <Text style={styles.legendText}>Filtered (Q={q.toFixed(2)}, R={r.toFixed(1)})</Text>
          </View>
        </View>

        {/* Chart area */}
        <View style={[styles.chart, { height: CHART_HEIGHT + 24 }]}>
          {/* Y-axis labels */}
          <View style={styles.yAxis}>
            <Text style={styles.yLabel}>{RSSI_MAX}</Text>
            <Text style={styles.yLabel}>{Math.round((RSSI_MAX + RSSI_MIN) / 2)}</Text>
            <Text style={styles.yLabel}>{RSSI_MIN}</Text>
          </View>

          {/* Bars */}
          <View style={[styles.barsArea, { height: CHART_HEIGHT }]}>
            {/* Horizontal grid lines */}
            <View style={[styles.gridLine, { bottom: CHART_HEIGHT * 0.5 }]} />
            <View style={[styles.gridLine, { bottom: 0 }]} />
            <View style={[styles.gridLine, { bottom: CHART_HEIGHT }]} />

            {rawHistory.length === 0 ? (
              <View style={styles.chartEmpty}>
                <Text style={styles.chartEmptyText}>
                  {selected
                    ? 'Waiting for RSSI readings...'
                    : 'Load synthetic demo above or select a device'}
                </Text>
              </View>
            ) : (
              <View style={styles.barsRow}>
                {rawHistory.map((raw, i) => {
                  const filt = reFilteredHistory[i] ?? raw;
                  const rawH = Math.round(normalizeRssi(raw) * CHART_HEIGHT);
                  const filtH = Math.round(normalizeRssi(filt) * CHART_HEIGHT);
                  return (
                    <View key={i} style={[styles.barGroup, { width: barWidth * 2 + 2 }]}>
                      {/* Raw bar (gray) */}
                      <View
                        style={[
                          styles.bar,
                          { height: rawH, width: barWidth, backgroundColor: '#C7C7CC' },
                        ]}
                      />
                      {/* Filtered bar (blue) */}
                      <View
                        style={[
                          styles.bar,
                          { height: filtH, width: barWidth, backgroundColor: '#007AFF' },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
        <Text style={styles.chartCaption}>
          Each pair: gray = raw, blue = filtered · Last {rawHistory.length}/{30} samples
        </Text>
      </View>

      {/* ── Section: Statistics ── */}
      {stats && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistics ({stats.samples} samples)</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Raw Average</Text>
              <Text style={styles.statValue}>{stats.rawAvg} dBm</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Filtered Average</Text>
              <Text style={[styles.statValue, { color: '#007AFF' }]}>
                {stats.filtAvg} dBm
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Raw Std Dev</Text>
              <Text style={styles.statValue}>{stats.rawStdDev} dBm</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Filtered Std Dev</Text>
              <Text style={[styles.statValue, { color: '#007AFF' }]}>
                {stats.filtStdDev} dBm
              </Text>
            </View>
          </View>
          <Text style={styles.statsHint}>
            A lower Filtered Std Dev confirms the filter is reducing noise.
          </Text>
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    paddingVertical: 12,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  syntheticButtons: {
    gap: 10,
  },
  syntheticPrimary: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  syntheticPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  syntheticSecondary: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  syntheticSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  expectedBox: {
    marginTop: 14,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#34C759',
  },
  expectedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 6,
  },
  expectedBody: {
    fontSize: 12,
    color: '#636366',
    lineHeight: 18,
  },
  syntheticBanner: {
    backgroundColor: '#FF9F0A18',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FF9F0A40',
  },
  syntheticBannerText: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  emptyHint: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyHintText: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Device selector rows
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#F2F2F7',
  },
  deviceRowActive: {
    backgroundColor: '#007AFF15',
    borderWidth: 1,
    borderColor: '#007AFF40',
  },
  deviceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  deviceRowInfo: {
    flex: 1,
  },
  deviceRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  deviceRowId: {
    fontSize: 10,
    color: '#8E8E93',
    marginTop: 1,
  },
  deviceRowRssi: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
  checkmark: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 4,
  },
  // Parameter controls
  paramHint: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 14,
  },
  steppers: {
    gap: 12,
  },
  stepperDivider: {
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  paramExplain: {
    marginTop: 14,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 10,
  },
  paramExplainText: {
    fontSize: 12,
    color: '#636366',
    lineHeight: 18,
  },
  bold: {
    fontWeight: '700',
    color: '#1C1C1E',
  },
  // Chart
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 11,
    color: '#636366',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  yAxis: {
    width: 36,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  yLabel: {
    fontSize: 9,
    color: '#AEAEB2',
  },
  barsArea: {
    flex: 1,
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E5EA',
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#E5E5EA80',
  },
  barsRow: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
  },
  bar: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    minHeight: 2,
  },
  chartEmpty: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmptyText: {
    fontSize: 13,
    color: '#AEAEB2',
    textAlign: 'center',
  },
  chartCaption: {
    fontSize: 10,
    color: '#AEAEB2',
    marginTop: 6,
    textAlign: 'center',
  },
  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCell: {
    width: '45%',
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 10,
  },
  statLabel: {
    fontSize: 11,
    color: '#8E8E93',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  statsHint: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 12,
    fontStyle: 'italic',
  },
});
