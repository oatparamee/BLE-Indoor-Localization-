import React, {useState, useRef, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import Svg, {
  Line as SvgLine,
  Path,
  Polyline,
  Circle,
  Rect,
  G,
  Text as SvgText,
} from 'react-native-svg';
import {bleScanner, BeaconReading} from '../services/bleScanner';

interface BeaconProfile {
  id: string;
  name: string;
  distance: number;
  readings: number[];
  mean: number;
  stdDev: number;
  variance: number;
  suggestedQ: number;
}

const BEACON_COLORS = [
  '#58a6ff',
  '#3fb950',
  '#f0883e',
  '#d2a8ff',
  '#ff7b72',
  '#79c0ff',
];

const HIST_MIN = -100;
const HIST_MAX = -30;
const BIN_WIDTH = 5;
const NUM_BINS = (HIST_MAX - HIST_MIN) / BIN_WIDTH; // 14

function computeStats(readings: number[]) {
  if (readings.length === 0) {
    return {mean: 0, stdDev: 0, variance: 0, suggestedQ: 0};
  }
  const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
  const variance =
    readings.reduce((a, b) => a + (b - mean) ** 2, 0) / readings.length;
  // Q = variance of consecutive differences / 2.
  // For static data this ≈ R; the /2 removes the double-counting of measurement
  // noise so Q ends up slightly below R — a reasonable 1D RSSI filter starting point.
  let suggestedQ = variance * 0.1;
  if (readings.length >= 2) {
    const diffs = readings.slice(1).map((v, i) => v - readings[i]);
    const meanD = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const varDiffs =
      diffs.reduce((a, b) => a + (b - meanD) ** 2, 0) / diffs.length;
    suggestedQ = Math.max(variance * 0.001, varDiffs / 2);
  }
  return {mean, stdDev: Math.sqrt(variance), variance, suggestedQ};
}

function computeBins(readings: number[]): number[] {
  const counts = Array(NUM_BINS).fill(0) as number[];
  readings.forEach(rssi => {
    const idx = Math.floor((rssi - HIST_MIN) / BIN_WIDTH);
    counts[Math.max(0, Math.min(NUM_BINS - 1, idx))]++;
  });
  return counts;
}

// ── Polynomial fit helpers ─────────────────────────────────────────
// Solve a square linear system A·x = b using Gaussian elimination
// with partial pivoting. Returns null if the system is singular.
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map(row => row.slice());
  const v = b.slice();

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    if (pivot !== i) {
      [M[i], M[pivot]] = [M[pivot], M[i]];
      [v[i], v[pivot]] = [v[pivot], v[i]];
    }
    if (Math.abs(M[i][i]) < 1e-12) return null;

    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= factor * M[i][j];
      v[k] -= factor * v[i];
    }
  }

  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = v[i];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * out[j];
    out[i] = sum / M[i][i];
  }
  return out;
}

// Least-squares polynomial fit. Returns coefficients [a0, a1, ..., aD]
// for p(x) = a0 + a1·x + a2·x² + ... + aD·xᴰ.
function polyFit(xs: number[], ys: number[], degree: number): number[] | null {
  const n = xs.length;
  if (n < degree + 1) return null;
  const m = degree + 1;
  const ATA: number[][] = Array.from({length: m}, () =>
    new Array(m).fill(0),
  );
  const ATy: number[] = new Array(m).fill(0);

  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const powers = new Array<number>(m);
    powers[0] = 1;
    for (let j = 1; j < m; j++) powers[j] = powers[j - 1] * x;
    for (let r = 0; r < m; r++) {
      ATy[r] += powers[r] * y;
      for (let c = 0; c < m; c++) ATA[r][c] += powers[r] * powers[c];
    }
  }
  return solveLinear(ATA, ATy);
}

function evalPoly(coeffs: number[], x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) result = result * x + coeffs[i];
  return result;
}

// Pick "round" tick values (1, 2, 5, 10, 20, ...) that fit ~`count` ticks
// in the given range.
function niceStep(range: number, count: number): number {
  if (range <= 0) return 1;
  const target = range / Math.max(1, count);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  return steps.find(s => s >= target) ?? Math.ceil(target);
}

function niceTicks(min: number, max: number, count: number): number[] {
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

// Auto Y range for RSSI data. Pads so the curve never touches the frame
// and keeps a minimum span so a flat signal still looks readable.
function autoYRange(values: number[], minSpan = 6): {min: number; max: number} {
  if (values.length === 0) return {min: -90, max: -40};
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  let span = Math.max(minSpan, vMax - vMin);
  const center = (vMax + vMin) / 2;
  const min = Math.floor(center - span / 2 - 0.5);
  const max = Math.ceil(center + span / 2 + 0.5);
  return {min, max};
}

function RssiVariationChart({
  readings,
  mean,
}: {
  readings: number[];
  mean: number;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  const CHART_HEIGHT = 240;
  const PAD_LEFT = 46;
  const PAD_RIGHT = 14;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 38;

  const innerW = Math.max(0, chartWidth - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const {min: yMin, max: yMax} = autoYRange(readings, 6);
  const xN = readings.length;
  const xMaxIndex = Math.max(1, xN - 1);

  const xToPx = (i: number): number =>
    PAD_LEFT + (xN > 1 ? (i / xMaxIndex) * innerW : innerW / 2);
  const yToPx = (v: number): number =>
    PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  // 4th-degree polynomial fit on x normalized to [0, 1] for numerical stability.
  let polyPath: string | null = null;
  if (readings.length >= 5) {
    const xsNorm = readings.map((_, i) => i / xMaxIndex);
    const coeffs = polyFit(xsNorm, readings, 4);
    if (coeffs) {
      const STEPS = Math.max(40, Math.min(160, xN * 4));
      const segs: string[] = [];
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const yFit = evalPoly(coeffs, t);
        const xPx = PAD_LEFT + t * innerW;
        const yPx = PAD_TOP + (1 - (yFit - yMin) / (yMax - yMin)) * innerH;
        segs.push(`${s === 0 ? 'M' : 'L'}${xPx.toFixed(2)},${yPx.toFixed(2)}`);
      }
      polyPath = segs.join(' ');
    }
  }

  const yTicks = niceTicks(yMin, yMax, 6);
  const xTicks = niceTicks(0, xMaxIndex, 6).filter(
    (v, idx, arr) => idx === 0 || v !== arr[idx - 1],
  );

  const rawLinePoints = readings
    .map((v, i) => `${xToPx(i).toFixed(2)},${yToPx(v).toFixed(2)}`)
    .join(' ');

  return (
    <View
      style={[sc.container, {height: CHART_HEIGHT}]}
      onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
      {chartWidth > 0 && (
        <Svg width={chartWidth} height={CHART_HEIGHT}>
          <Rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={innerW}
            height={innerH}
            fill="#0d1117"
            stroke="#30363d"
            strokeWidth={1}
          />
          {yTicks.map((t, idx) => {
            const y = yToPx(t);
            return (
              <G key={`y${idx}`}>
                <SvgLine
                  x1={PAD_LEFT}
                  y1={y}
                  x2={PAD_LEFT + innerW}
                  y2={y}
                  stroke="#21262d"
                  strokeWidth={1}
                />
                <SvgText
                  x={PAD_LEFT - 5}
                  y={y + 3}
                  fontSize={9}
                  textAnchor="end"
                  fill="#8b949e">
                  {t.toFixed(0)}
                </SvgText>
              </G>
            );
          })}
          {xTicks.map((t, idx) => {
            const x = xToPx(t);
            return (
              <G key={`x${idx}`}>
                <SvgLine
                  x1={x}
                  y1={PAD_TOP}
                  x2={x}
                  y2={PAD_TOP + innerH}
                  stroke="#21262d"
                  strokeWidth={1}
                />
                <SvgText
                  x={x}
                  y={PAD_TOP + innerH + 14}
                  fontSize={9}
                  textAnchor="middle"
                  fill="#8b949e">
                  {t}
                </SvgText>
              </G>
            );
          })}
          {readings.length > 0 && (
            <SvgLine
              x1={PAD_LEFT}
              y1={yToPx(mean)}
              x2={PAD_LEFT + innerW}
              y2={yToPx(mean)}
              stroke="#3fb950"
              strokeWidth={1.6}
              strokeDasharray="6 4"
            />
          )}
          {polyPath && (
            <Path d={polyPath} stroke="#ff7b72" strokeWidth={2} fill="none" />
          )}
          {readings.length > 1 && (
            <Polyline
              points={rawLinePoints}
              stroke="#58a6ff"
              strokeWidth={1.4}
              fill="none"
            />
          )}
          {readings.map((v, i) => (
            <Circle
              key={`pt${i}`}
              cx={xToPx(i)}
              cy={yToPx(v)}
              r={2.6}
              fill="#58a6ff"
              stroke="#0d1117"
              strokeWidth={0.5}
            />
          ))}
          <SvgText
            x={14}
            y={PAD_TOP + innerH / 2}
            fontSize={10}
            fill="#c9d1d9"
            textAnchor="middle"
            transform={`rotate(-90 14 ${PAD_TOP + innerH / 2})`}>
            RSSI (dBm)
          </SvgText>
          <SvgText
            x={PAD_LEFT + innerW / 2}
            y={CHART_HEIGHT - 4}
            fontSize={10}
            fill="#c9d1d9"
            textAnchor="middle">
            Measurement Index
          </SvgText>
        </Svg>
      )}
      {chartWidth > 0 && (
        <View style={chartStyles.legend}>
          <View style={chartStyles.legendRow}>
            <View
              style={[chartStyles.legendLine, {backgroundColor: '#58a6ff'}]}
            />
            <View
              style={[chartStyles.legendDot, {backgroundColor: '#58a6ff'}]}
            />
            <Text style={chartStyles.legendText}>RSSI readings</Text>
          </View>
          <View style={chartStyles.legendRow}>
            <View
              style={[chartStyles.legendLine, {backgroundColor: '#ff7b72'}]}
            />
            <Text style={chartStyles.legendText}>4th degree fit</Text>
          </View>
          <View style={chartStyles.legendRow}>
            <View style={chartStyles.legendDashRow}>
              <View
                style={[
                  chartStyles.legendDashSegment,
                  {backgroundColor: '#3fb950'},
                ]}
              />
              <View
                style={[
                  chartStyles.legendDashSegment,
                  {backgroundColor: '#3fb950'},
                ]}
              />
            </View>
            <Text style={chartStyles.legendText}>RSSI mean</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function HistogramBars({
  profiles,
  selectedId,
  combined,
}: {
  profiles: BeaconProfile[];
  selectedId: string | null;
  combined: boolean;
}) {
  const CHART_HEIGHT = 120;

  const shown = combined
    ? profiles
    : profiles.filter(p => p.id === selectedId);

  if (shown.length === 0) {
    return (
      <Text style={styles.histoEmpty}>
        Select a beacon tab above to view its histogram
      </Text>
    );
  }

  const allBins = shown.map(p => computeBins(p.readings));
  const globalMax = Math.max(1, ...allBins.flatMap(b => b));

  return (
    <View>
      <View style={{flexDirection: 'row', height: CHART_HEIGHT}}>
        {Array.from({length: NUM_BINS}).map((_, binIdx) => {
          if (combined) {
            return (
              <View key={binIdx} style={{flex: 1, height: CHART_HEIGHT}}>
                {shown.map((profile, pIdx) => {
                  const count = allBins[pIdx][binIdx];
                  if (count === 0) {
                    return null;
                  }
                  const barH = (count / globalMax) * CHART_HEIGHT;
                  const globalIdx = profiles.indexOf(profile);
                  const color =
                    BEACON_COLORS[globalIdx % BEACON_COLORS.length];
                  return (
                    <View
                      key={profile.id}
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 1,
                        right: 1,
                        height: barH,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  );
                })}
              </View>
            );
          } else {
            const count = allBins[0]?.[binIdx] ?? 0;
            const barH =
              count > 0
                ? Math.max(2, (count / globalMax) * CHART_HEIGHT)
                : 0;
            const profileIdx = profiles.findIndex(p => p.id === selectedId);
            const color =
              BEACON_COLORS[Math.max(0, profileIdx) % BEACON_COLORS.length];
            return (
              <View
                key={binIdx}
                style={{
                  flex: 1,
                  height: CHART_HEIGHT,
                  justifyContent: 'flex-end',
                }}>
                <View
                  style={{
                    height: barH,
                    marginHorizontal: 1,
                    backgroundColor: color,
                    borderTopLeftRadius: 1,
                    borderTopRightRadius: 1,
                  }}
                />
              </View>
            );
          }
        })}
      </View>
      {/* X-axis labels */}
      <View style={{flexDirection: 'row', marginTop: 4}}>
        {Array.from({length: NUM_BINS}).map((_, i) => (
          <View key={i} style={{flex: 1, alignItems: 'center'}}>
            {i % 2 === 0 && (
              <Text style={styles.axisLabel}>
                {HIST_MIN + i * BIN_WIDTH}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

export default function RSSIProfileScreen() {
  const [distance, setDistance] = useState('1.0');
  const [sampleCountInput, setSampleCountInput] = useState('50');
  const [collecting, setCollecting] = useState(false);
  const [currentReadings, setCurrentReadings] = useState<number[]>([]);
  const [samplesCollected, setSamplesCollected] = useState(0);
  const [maxSamples, setMaxSamples] = useState(50);
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedBeaconId, setSelectedBeaconId] = useState('');
  const [detectedBeacons, setDetectedBeacons] = useState<BeaconReading[]>([]);
  const [profiles, setProfiles] = useState<BeaconProfile[]>([]);
  const [showCombined, setShowCombined] = useState(false);
  const [selectedHistoId, setSelectedHistoId] = useState<string | null>(null);

  const collectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const beaconReadingsRef = useRef<Record<string, BeaconReading>>({});
  const selectedIdRef = useRef('');
  const readingsAccRef = useRef<number[]>([]);

  useEffect(() => {
    selectedIdRef.current = selectedBeaconId;
  }, [selectedBeaconId]);

  useEffect(() => {
    const unsub = bleScanner.subscribe((readings, nearby) => {
      beaconReadingsRef.current = readings;
      setDetectedBeacons(nearby);
      if (!selectedIdRef.current && nearby.length > 0) {
        const first = nearby[0];
        selectedIdRef.current = first.id;
        setSelectedBeaconId(first.id);
      }
    });
    return () => {
      if (collectIntervalRef.current) {
        clearInterval(collectIntervalRef.current);
        collectIntervalRef.current = null;
      }
      unsub();
    };
  }, []);

  const startCollecting = useCallback(() => {
    const dist = parseFloat(distance);
    if (isNaN(dist) || dist <= 0) {
      Alert.alert('Invalid Distance', 'Enter a positive distance in meters.');
      return;
    }
    const count = parseInt(sampleCountInput, 10);
    if (!Number.isFinite(count) || count < 5) {
      Alert.alert('Invalid Count', 'Enter at least 5 samples.');
      return;
    }
    if (!selectedIdRef.current) {
      Alert.alert('No Beacon', 'Tap a beacon in the list above.');
      return;
    }

    setMaxSamples(count);
    setCollecting(true);
    setCurrentReadings([]);
    setSamplesCollected(0);
    readingsAccRef.current = [];
    setStatusMessage('Starting collection...');

    const tick = () => {
      const live = bleScanner.getReadings();
      const id = selectedIdRef.current;
      const beacon = live[id] ?? beaconReadingsRef.current[id];

      if (!beacon || beacon.rawRssi === null || !beacon.active) {
        setStatusMessage(`Waiting for ${beacon?.name ?? id}...`);
        return;
      }

      readingsAccRef.current = [...readingsAccRef.current, beacon.rawRssi];
      const n = readingsAccRef.current.length;
      setCurrentReadings([...readingsAccRef.current]);
      setSamplesCollected(n);
      setStatusMessage(
        `Sample ${n}/${count} — RSSI: ${beacon.rawRssi} dBm (${beacon.name})`,
      );

      if (n >= count) {
        if (collectIntervalRef.current) {
          clearInterval(collectIntervalRef.current);
          collectIntervalRef.current = null;
        }
        setCollecting(false);

        const allReadings = readingsAccRef.current;
        const stats = computeStats(allReadings);
        const profile: BeaconProfile = {
          id,
          name: beacon.name,
          distance: dist,
          readings: allReadings,
          mean: stats.mean,
          stdDev: stats.stdDev,
          variance: stats.variance,
          suggestedQ: stats.suggestedQ,
        };

        setProfiles(prev => {
          const without = prev.filter(p => p.id !== id);
          return [...without, profile];
        });
        setSelectedHistoId(id);
        setStatusMessage(
          `Done! Mean: ${stats.mean.toFixed(1)} dBm  |  σ: ${stats.stdDev.toFixed(2)}  |  σ²: ${stats.variance.toFixed(2)}`,
        );
      }
    };

    tick();
    collectIntervalRef.current = setInterval(tick, 500);
  }, [distance, sampleCountInput]);

  const stopCollecting = useCallback(() => {
    if (collectIntervalRef.current) {
      clearInterval(collectIntervalRef.current);
      collectIntervalRef.current = null;
    }
    setCollecting(false);
    setStatusMessage('Collection stopped.');
  }, []);

  const clearProfile = useCallback(
    (id: string) => {
      setProfiles(prev => prev.filter(p => p.id !== id));
      if (selectedHistoId === id) {
        setSelectedHistoId(null);
      }
    },
    [selectedHistoId],
  );

  const progressPercent =
    maxSamples > 0 ? (samplesCollected / maxSamples) * 100 : 0;
  const currentStats =
    currentReadings.length > 0 ? computeStats(currentReadings) : null;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>RSSI Profile</Text>
      <Text style={styles.subtitle}>
        Collect readings at a fixed distance per beacon to get mean + σ for
        Kalman noise parameters
      </Text>

      {/* Beacon selector */}
      <View style={styles.section}>
        <Text style={styles.label}>Select beacon:</Text>
        {detectedBeacons.length === 0 ? (
          <Text style={styles.hint}>
            Scanning... make sure Bluetooth is on.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.beaconRow}>
            {detectedBeacons.map(dev => {
              const isSel = dev.id === selectedBeaconId;
              const hasProfile = profiles.some(p => p.id === dev.id);
              return (
                <TouchableOpacity
                  key={dev.id}
                  style={[styles.beaconBtn, isSel && styles.beaconBtnActive]}
                  onPress={() => {
                    setSelectedBeaconId(dev.id);
                    selectedIdRef.current = dev.id;
                  }}>
                  <Text
                    style={[
                      styles.beaconBtnText,
                      isSel && styles.beaconBtnTextActive,
                    ]}>
                    {dev.name}
                    {hasProfile ? ' ✓' : ''}
                  </Text>
                  <Text
                    style={[
                      styles.beaconBtnSub,
                      isSel && styles.beaconBtnSubActive,
                    ]}>
                    {dev.rawRssi !== null ? `${dev.rawRssi} dBm` : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Config row */}
      <View style={styles.section}>
        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.label}>Fixed distance (m):</Text>
            <TextInput
              style={styles.input}
              value={distance}
              onChangeText={setDistance}
              keyboardType="decimal-pad"
              editable={!collecting}
              placeholder="1.0"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.label}>Samples:</Text>
            <TextInput
              style={styles.input}
              value={sampleCountInput}
              onChangeText={setSampleCountInput}
              keyboardType="number-pad"
              editable={!collecting}
              placeholder="50"
              placeholderTextColor="#6e7681"
            />
          </View>
        </View>
      </View>

      {/* Start / Stop */}
      <View style={styles.section}>
        {!collecting ? (
          <TouchableOpacity style={styles.btnPrimary} onPress={startCollecting}>
            <Text style={styles.btnText}>Start Collection</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnDanger} onPress={stopCollecting}>
            <Text style={styles.btnText}>Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress */}
      <View style={styles.section}>
        <Text style={styles.label}>
          Progress: {samplesCollected} / {maxSamples}
        </Text>
        <View style={styles.progressBg}>
          <View
            style={[styles.progressFill, {width: `${progressPercent}%`}]}
          />
        </View>
        {statusMessage ? (
          <Text style={styles.statusText}>{statusMessage}</Text>
        ) : null}
      </View>

      {/* Live RSSI variation chart */}
      {currentReadings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RSSI variation</Text>
          <Text style={styles.chartCaption}>
            Blue: raw RSSI samples · Red: 4th-degree polynomial fit · Green
            dashed: RSSI mean
          </Text>
          <RssiVariationChart
            readings={currentReadings}
            mean={currentStats?.mean ?? 0}
          />
          {currentStats && (
            <View>
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Mean</Text>
                  <Text style={styles.statValue}>
                    {currentStats.mean.toFixed(1)} dBm
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>σ (Std Dev)</Text>
                  <Text style={styles.statValue}>
                    {currentStats.stdDev.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>n</Text>
                  <Text style={styles.statValue}>{currentReadings.length}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={[styles.statBox, styles.kalmanBox]}>
                  <Text style={styles.statLabel}>R = σ²</Text>
                  <Text style={[styles.statValue, styles.kalmanR]}>
                    {currentStats.variance.toFixed(4)}
                  </Text>
                </View>
                <View style={[styles.statBox, styles.kalmanBox]}>
                  <Text style={styles.statLabel}>Q (suggested)</Text>
                  <Text style={[styles.statValue, styles.kalmanQ]}>
                    {currentStats.suggestedQ.toFixed(4)}
                  </Text>
                </View>
                <View style={[styles.statBox, styles.kalmanBox]}>
                  <Text style={styles.statLabel}>Q/R</Text>
                  <Text style={[styles.statValue, styles.kalmanQR]}>
                    {currentStats.variance > 0
                      ? (currentStats.suggestedQ / currentStats.variance).toFixed(3)
                      : '—'}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Averaged Q / R summary — feed these into the 1D KF stage */}
      {profiles.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1D KF Parameters</Text>
          <Text style={styles.hint}>
            Average Q and R across all beacons — use these as the single
            Q_avg / R_avg for the 1D Kalman filter applied to every beacon's
            raw RSSI before trilateration.
          </Text>
          <View style={styles.avgBox}>
            <View style={styles.statsRow}>
              <View style={[styles.statBox, styles.kalmanBox, {flex: 2}]}>
                <Text style={styles.statLabel}>R_avg = mean(σ²)</Text>
                <Text style={[styles.statValue, styles.kalmanR, {fontSize: 18}]}>
                  {(
                    profiles.reduce((s, p) => s + p.variance, 0) /
                    profiles.length
                  ).toFixed(4)}
                </Text>
              </View>
              <View style={[styles.statBox, styles.kalmanBox, {flex: 2}]}>
                <Text style={styles.statLabel}>Q_avg = mean(Q)</Text>
                <Text style={[styles.statValue, styles.kalmanQ, {fontSize: 18}]}>
                  {(
                    profiles.reduce((s, p) => s + p.suggestedQ, 0) /
                    profiles.length
                  ).toFixed(4)}
                </Text>
              </View>
              <View style={[styles.statBox, styles.kalmanBox, {flex: 1}]}>
                <Text style={styles.statLabel}>Q/R</Text>
                <Text style={[styles.statValue, styles.kalmanQR]}>
                  {(() => {
                    const rAvg =
                      profiles.reduce((s, p) => s + p.variance, 0) /
                      profiles.length;
                    const qAvg =
                      profiles.reduce((s, p) => s + p.suggestedQ, 0) /
                      profiles.length;
                    return rAvg > 0 ? (qAvg / rAvg).toFixed(3) : '—';
                  })()}
                </Text>
              </View>
            </View>
            <Text style={styles.avgNote}>
              {profiles.length === 1
                ? 'Add more beacons to get a more representative average.'
                : `Averaged over ${profiles.length} beacons.`}
            </Text>
          </View>
        </View>
      )}

      {/* Per-beacon profiles */}
      {profiles.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Per-Beacon Profiles</Text>
          <Text style={styles.hint}>
            Individual Q and R — compare across beacons to check consistency.
          </Text>
          {profiles.map((p, pIdx) => {
            const color = BEACON_COLORS[pIdx % BEACON_COLORS.length];
            return (
              <View
                key={p.id}
                style={[styles.profileCard, {borderLeftColor: color}]}>
                <View style={styles.profileHeader}>
                  <View style={{flex: 1}}>
                    <Text style={styles.profileName}>{p.name}</Text>
                    <Text style={styles.profileSub}>
                      @ {p.distance} m · {p.readings.length} samples
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => clearProfile(p.id)}>
                    <Text style={styles.clearBtn}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Mean</Text>
                    <Text style={[styles.statValue, {color}]}>
                      {p.mean.toFixed(1)} dBm
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>σ (Std Dev)</Text>
                    <Text style={[styles.statValue, {color}]}>
                      {p.stdDev.toFixed(2)}
                    </Text>
                  </View>
                </View>
                <View style={styles.statsRow}>
                  <View style={[styles.statBox, styles.kalmanBox]}>
                    <Text style={styles.statLabel}>R = σ²</Text>
                    <Text style={[styles.statValue, styles.kalmanR]}>
                      {p.variance.toFixed(4)}
                    </Text>
                  </View>
                  <View style={[styles.statBox, styles.kalmanBox]}>
                    <Text style={styles.statLabel}>Q (suggested)</Text>
                    <Text style={[styles.statValue, styles.kalmanQ]}>
                      {p.suggestedQ.toFixed(4)}
                    </Text>
                  </View>
                  <View style={[styles.statBox, styles.kalmanBox]}>
                    <Text style={styles.statLabel}>Q/R</Text>
                    <Text style={[styles.statValue, styles.kalmanQR]}>
                      {p.variance > 0
                        ? (p.suggestedQ / p.variance).toFixed(3)
                        : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Histograms */}
      {profiles.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RSSI Histograms</Text>

          {/* Toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                !showCombined && styles.toggleBtnActive,
              ]}
              onPress={() => setShowCombined(false)}>
              <Text
                style={[
                  styles.toggleBtnText,
                  !showCombined && styles.toggleBtnTextActive,
                ]}>
                Individual
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                showCombined && styles.toggleBtnActive,
                profiles.length < 2 && styles.toggleBtnDisabled,
              ]}
              onPress={() => setShowCombined(true)}
              disabled={profiles.length < 2}>
              <Text
                style={[
                  styles.toggleBtnText,
                  showCombined && styles.toggleBtnTextActive,
                  profiles.length < 2 && styles.toggleBtnTextDisabled,
                ]}>
                Combined{profiles.length < 2 ? ' (need 2+)' : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Per-beacon tabs (individual mode) */}
          {!showCombined && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.beaconRow, {marginBottom: 10}]}>
              {profiles.map((p, pIdx) => {
                const isSel = p.id === selectedHistoId;
                const color = BEACON_COLORS[pIdx % BEACON_COLORS.length];
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.histoTab,
                      isSel && {
                        borderBottomColor: color,
                        borderBottomWidth: 2,
                      },
                    ]}
                    onPress={() => setSelectedHistoId(p.id)}>
                    <Text
                      style={[styles.histoTabText, isSel && {color}]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Legend (combined mode) */}
          {showCombined && (
            <View style={styles.legendRow}>
              {profiles.map((p, pIdx) => (
                <View key={p.id} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor:
                          BEACON_COLORS[pIdx % BEACON_COLORS.length],
                      },
                    ]}
                  />
                  <Text style={styles.legendText}>{p.name}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.histoContainer}>
            <HistogramBars
              profiles={profiles}
              selectedId={selectedHistoId}
              combined={showCombined}
            />
          </View>
          <Text style={styles.chartCaption}>
            X: RSSI (dBm) · Y: reading count · bin width:{' '}
            {BIN_WIDTH} dBm
            {showCombined ? ' · overlapping bars, 70% opacity' : ''}
          </Text>
        </View>
      )}

      <View style={{height: 40}} />
    </ScrollView>
  );
}

const sc = StyleSheet.create({
  container: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    overflow: 'hidden',
  },
});

const chartStyles = StyleSheet.create({
  legend: {
    position: 'absolute',
    top: 22,
    right: 22,
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  legendDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: -10,
  },
  legendDashRow: {
    width: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  legendDashSegment: {
    width: 5,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    color: '#c9d1d9',
    fontSize: 10,
    fontWeight: '500',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    marginBottom: 20,
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 10,
  },
  label: {
    fontSize: 15,
    color: '#c9d1d9',
    marginBottom: 8,
  },
  hint: {
    color: '#6e7681',
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#e6edf3',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  halfField: {
    flex: 1,
  },
  beaconRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  beaconBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    minWidth: 110,
  },
  beaconBtnActive: {
    backgroundColor: '#1f6feb',
    borderColor: '#1f6feb',
  },
  beaconBtnText: {
    color: '#c9d1d9',
    fontSize: 13,
    fontWeight: '600',
  },
  beaconBtnTextActive: {
    color: '#ffffff',
  },
  beaconBtnSub: {
    color: '#6e7681',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  beaconBtnSubActive: {
    color: '#c9d1d9',
  },
  btnPrimary: {
    backgroundColor: '#1f6feb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDanger: {
    backgroundColor: '#da3633',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressBg: {
    height: 12,
    backgroundColor: '#21262d',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1f6feb',
    borderRadius: 6,
  },
  statusText: {
    fontSize: 13,
    color: '#8b949e',
    fontStyle: 'italic',
  },
  chartCaption: {
    fontSize: 11,
    color: '#6e7681',
    marginTop: 6,
    fontStyle: 'italic',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: '#8b949e',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e6edf3',
    fontFamily: 'monospace',
  },
  profileCard: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileName: {
    color: '#e6edf3',
    fontSize: 15,
    fontWeight: '700',
  },
  profileSub: {
    color: '#6e7681',
    fontSize: 12,
    marginTop: 2,
  },
  clearBtn: {
    color: '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  toggleBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    backgroundColor: '#161b22',
  },
  toggleBtnActive: {
    borderColor: '#1f6feb',
    backgroundColor: '#0d1f3c',
  },
  toggleBtnDisabled: {
    opacity: 0.4,
  },
  toggleBtnText: {
    fontSize: 14,
    color: '#8b949e',
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: '#58a6ff',
  },
  toggleBtnTextDisabled: {
    color: '#6e7681',
  },
  histoTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  histoTabText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '600',
  },
  histoEmpty: {
    color: '#6e7681',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: '#c9d1d9',
    fontSize: 12,
  },
  histoContainer: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 8,
    paddingBottom: 4,
  },
  axisLabel: {
    fontSize: 8,
    color: '#6e7681',
    fontFamily: 'monospace',
  },
  avgBox: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 10,
    padding: 12,
  },
  avgNote: {
    color: '#6e7681',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  kalmanBox: {
    borderColor: '#21262d',
  },
  kalmanR: {
    color: '#f0883e',
    fontFamily: 'monospace',
  },
  kalmanQ: {
    color: '#3fb950',
    fontFamily: 'monospace',
  },
  kalmanQR: {
    color: '#d2a8ff',
    fontFamily: 'monospace',
  },
});
