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

function ScatterChart({
  readings,
  mean,
  stdDev,
  collecting,
}: {
  readings: number[];
  mean: number;
  stdDev: number;
  collecting: boolean;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  const CHART_HEIGHT = 150;
  const RSSI_MIN = -100;
  const RSSI_MAX = -30;
  const MAX_POINTS = 80;

  const shown = readings.slice(-MAX_POINTS);

  const yPx = (rssi: number): number => {
    const frac = Math.max(
      0,
      Math.min(1, (rssi - RSSI_MIN) / (RSSI_MAX - RSSI_MIN)),
    );
    return (1 - frac) * CHART_HEIGHT;
  };

  const dotColor = collecting ? '#f0883e' : '#3fb950';

  return (
    <View
      style={[sc.container, {height: CHART_HEIGHT}]}
      onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
      {/* Grid lines */}
      {([-90, -80, -70, -60, -50, -40] as number[]).map(v => (
        <View
          key={v}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: yPx(v),
            height: 1,
            backgroundColor: '#21262d',
          }}
        />
      ))}
      {/* ±1σ band */}
      {readings.length > 0 && stdDev > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: yPx(mean + stdDev),
            height: Math.max(
              1,
              yPx(mean - stdDev) - yPx(mean + stdDev),
            ),
            backgroundColor: '#58a6ff',
            opacity: 0.1,
          }}
        />
      )}
      {/* Mean line */}
      {readings.length > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: yPx(mean),
            height: 1.5,
            backgroundColor: '#58a6ff',
            opacity: 0.9,
          }}
        />
      )}
      {/* Data dots */}
      {chartWidth > 0 &&
        shown.map((rssi, i) => {
          const x =
            shown.length > 1
              ? (i / (shown.length - 1)) * (chartWidth - 10) + 5
              : chartWidth / 2;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: x - 3,
                top: yPx(rssi) - 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: dotColor,
                opacity: 0.85,
              }}
            />
          );
        })}
      {/* Y-axis labels */}
      {([-40, -60, -80] as number[]).map(v => (
        <Text
          key={v}
          style={{
            position: 'absolute',
            right: 4,
            top: yPx(v) - 6,
            fontSize: 9,
            color: '#6e7681',
            fontFamily: 'monospace',
          }}>
          {v}
        </Text>
      ))}
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

      {/* Live scatter chart */}
      {currentReadings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Scatter</Text>
          <Text style={styles.chartCaption}>
            Dots = individual readings · Blue line = running mean · Shaded band
            = ±1σ
          </Text>
          <ScatterChart
            readings={currentReadings}
            mean={currentStats?.mean ?? 0}
            stdDev={currentStats?.stdDev ?? 0}
            collecting={collecting}
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
