import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Svg, {Circle, Polyline, G, Text as SvgText} from 'react-native-svg';
import {bleScanner} from '../services/bleScanner';
import {api} from '../services/api';
import {loadBeaconConfig, SavedBeacon} from '../config/beaconConfig';

interface TopCell {
  x: number;
  y: number;
  distance: number;
  sq_dist: number;
  weight: number;
  n_beacons: number;
}

interface PositionResult {
  ready: boolean;
  reason?: string;
  raw_position?: {x: number; y: number};
  smooth_position?: {x: number; y: number};
  velocity?: {vx: number; vy: number};
  active_beacons?: string[];
  overlap_beacons?: string[];
  registered_beacons?: string[];
  top_cells?: TopCell[];
  floor_rssi?: number;
  initialized?: boolean;
}

interface REstimate {
  R: number[][];
  rmse: number;
  n_samples: number;
  mean_residual: {x: number; y: number};
}

interface FpStatus {
  registered_beacons: string[];
  active_beacons: string[];
  latest_rssi?: Record<string, number>;
  sigma_a: number;
  R: number[][];
  r_source: string;
  initialized: boolean;
  fingerprint_summary: {
    cell_count: number;
    floor_rssi: number | null;
  };
}

const TRAIL_MAX = 30;
const RSSI_FLUSH_MS = 250;
const POSITION_POLL_MS = 500;

export default function FusionScreen() {
  const [beacons, setBeacons] = useState<SavedBeacon[]>([]);
  const [tracking, setTracking] = useState(false);
  const [position, setPosition] = useState<PositionResult | null>(null);
  const [fpStatus, setFpStatus] = useState<FpStatus | null>(null);
  const [rEstimate, setREstimate] = useState<REstimate | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [trail, setTrail] = useState<Array<{x: number; y: number}>>([]);
  const [sigmaAInput, setSigmaAInput] = useState('0.5');

  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  // Always-fresh beacon list for use inside the flush interval. Reading
  // off React state from the interval closure would pin the value to
  // whatever existed when startTracking() was called.
  const beaconsRef = useRef<SavedBeacon[]>([]);
  // Counters so the UI can show that BLE packets are actually flowing
  // (or, more importantly, that they are not).
  const [eventsSent, setEventsSent] = useState(0);
  const [eventsSentTotal, setEventsSentTotal] = useState(0);
  const eventsSinceLastTickRef = useRef(0);

  useEffect(() => {
    beaconsRef.current = beacons;
  }, [beacons]);

  const stopAllIntervals = useCallback(() => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Keep BLE scan alive while the screen is mounted (events drained on
  // a timer once tracking is started — same pattern as PositionScreen).
  useEffect(() => {
    unsubRef.current = bleScanner.subscribe(() => {});
    return () => {
      stopAllIntervals();
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [stopAllIntervals]);

  // Reload beacon list on every focus so positions added in the Beacons
  // tab show up here without an app restart.
  useFocusEffect(
    useCallback(() => {
      loadBeaconConfig().then(cfg => {
        const list = Object.values(cfg);
        setBeacons(list);
        beaconsRef.current = list;
      });
    }, []),
  );

  // ── Tracking lifecycle ─────────────────────────────────────────

  const startTracking = async () => {
    const sigma_a = parseFloat(sigmaAInput);
    if (!Number.isFinite(sigma_a) || sigma_a <= 0) {
      Alert.alert('Invalid sigma_a', 'Must be a positive number (m/s²).');
      return;
    }
    try {
      // Always pull a fresh beacon list right before tracking starts.
      // Otherwise a freshly added/edited beacon in the Setup tab would
      // not be available for the name→id translation below until the
      // user switched tabs.
      const cfg = await loadBeaconConfig();
      const beaconList = Object.values(cfg);
      setBeacons(beaconList);
      beaconsRef.current = beaconList;

      const res = await api.fpStart({sigma_a, seed_r_from_loo: true});
      setREstimate(res?.r_estimate ?? null);
      bleScanner.drainRawEvents();
      setTrail([]);
      setPosition(null);
      setEventsSent(0);
      setEventsSentTotal(0);
      eventsSinceLastTickRef.current = 0;
      setStatusMsg('Tracking — walk around.');
      setTracking(true);

      flushIntervalRef.current = setInterval(async () => {
        const events = bleScanner.drainRawEvents();
        if (events.length === 0) {
          setEventsSent(0);
          return;
        }
        // Mirror SiteSurveyScreen: translate the advertised name to the
        // registered beacon id so the backend's matcher recognises the
        // observation. The backend route ALSO canonicalises (defence in
        // depth) but doing it here keeps the wire format consistent and
        // gives the user predictable behaviour offline-of-registry.
        const byName = new Map(
          beaconsRef.current.map(b => [b.name, b.id]),
        );
        try {
          await api.fpRssiEvents(
            events.map(e => ({
              beacon_id: byName.get(e.beacon_name) ?? e.beacon_id,
              beacon_name: e.beacon_name,
              rssi: e.rssi,
            })),
          );
          setEventsSent(events.length);
          eventsSinceLastTickRef.current += events.length;
        } catch (err: any) {
          setStatusMsg(`RSSI flush error: ${err?.message ?? err}`);
        }
      }, RSSI_FLUSH_MS);

      pollIntervalRef.current = setInterval(async () => {
        // Snapshot events/sec since the last poll tick so the UI can
        // show whether packets are actually flowing.
        const sinceLast = eventsSinceLastTickRef.current;
        eventsSinceLastTickRef.current = 0;
        setEventsSentTotal(prev => prev + sinceLast);
        try {
          const p = (await api.fpPositionLatest()) as PositionResult;
          setPosition(p);
          if (p.ready && p.smooth_position) {
            setTrail(prev => {
              const next = [...prev, p.smooth_position!];
              return next.length > TRAIL_MAX ? next.slice(-TRAIL_MAX) : next;
            });
          }
          const s = (await api.fpStatus()) as FpStatus;
          setFpStatus(s);
        } catch (err: any) {
          setStatusMsg(`position poll error: ${err?.message ?? err}`);
        }
      }, POSITION_POLL_MS);
    } catch (e: any) {
      Alert.alert('Failed to start', e?.message ?? String(e));
    }
  };

  const stopTracking = async () => {
    stopAllIntervals();
    bleScanner.drainRawEvents();
    setTracking(false);
    setStatusMsg('Stopped.');
    try {
      await api.fpReset();
    } catch {}
  };

  const reseedR = async () => {
    try {
      const res = await api.fpStart({seed_r_from_loo: true});
      setREstimate(res?.r_estimate ?? null);
      setStatusMsg('R re-seeded from LOO.');
      setTrail([]);
      setPosition(null);
    } catch (e: any) {
      Alert.alert('Re-seed failed', e?.message ?? String(e));
    }
  };

  const applySigmaA = async () => {
    const sigma_a = parseFloat(sigmaAInput);
    if (!Number.isFinite(sigma_a) || sigma_a <= 0) {
      Alert.alert('Invalid sigma_a', 'Must be a positive number (m/s²).');
      return;
    }
    try {
      await api.fpParams({sigma_a});
      setStatusMsg(`sigma_a set to ${sigma_a}.`);
      // Refresh status so the displayed value is authoritative
      try {
        const s = (await api.fpStatus()) as FpStatus;
        setFpStatus(s);
      } catch {}
    } catch (e: any) {
      Alert.alert('Apply failed', e?.message ?? String(e));
    }
  };

  // ── SVG layout ─────────────────────────────────────────────────

  const bbox = useMemo(() => {
    const points: Array<{x: number; y: number}> = [...beacons];
    trail.forEach(p => points.push(p));
    if (position?.smooth_position) points.push(position.smooth_position);
    if (points.length === 0) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
      xMin: Math.floor(Math.min(...xs)) - 2,
      xMax: Math.ceil(Math.max(...xs)) + 2,
      yMin: Math.floor(Math.min(...ys)) - 2,
      yMax: Math.ceil(Math.max(...ys)) + 2,
    };
  }, [beacons, trail, position]);

  const PADDING = 30;
  const SCALE = 12; // px per meter — modest so the long corridor fits
  const svgW = bbox ? (bbox.xMax - bbox.xMin) * SCALE + PADDING * 2 : 240;
  const svgH = bbox ? (bbox.yMax - bbox.yMin) * SCALE + PADDING * 2 : 240;
  const toSvgX = (x: number) => PADDING + (x - (bbox?.xMin ?? 0)) * SCALE;
  const toSvgY = (y: number) =>
    svgH - PADDING - (y - (bbox?.yMin ?? 0)) * SCALE;

  const trailPoints = trail
    .map(p => `${toSvgX(p.x)},${toSvgY(p.y)}`)
    .join(' ');

  // ── Render helpers ─────────────────────────────────────────────

  const formatMatrix = (m: number[][] | undefined): string => {
    if (!m) return '—';
    return m
      .map(row => '[ ' + row.map(v => v.toFixed(4).padStart(8)).join('  ') + ' ]')
      .join('\n');
  };

  const speed = position?.velocity
    ? Math.sqrt(position.velocity.vx ** 2 + position.velocity.vy ** 2)
    : null;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Sensor Fusion</Text>
      <Text style={styles.subtitle}>
        Raw RSSI → Gaussian fingerprint match → 4D Kalman filter on{' '}
        [x, y, vx, vy]. R comes from LOO cross-val on the survey; Q
        from sigma_a × dt.
      </Text>

      {/* Start / Stop */}
      <View style={styles.section}>
        {!tracking ? (
          <TouchableOpacity style={styles.primaryButton} onPress={startTracking}>
            <Text style={styles.primaryButtonText}>Start tracking</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={reseedR}>
              <Text style={styles.secondaryButtonText}>Re-seed R</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.destructiveButton}
              onPress={stopTracking}>
              <Text style={styles.destructiveButtonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}
        {statusMsg ? (
          <Text style={styles.statusText}>{statusMsg}</Text>
        ) : null}
      </View>

      {/* Position readout */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Position</Text>
        {position?.ready && position.smooth_position ? (
          <>
            <Text style={styles.bigNumber}>
              ({position.smooth_position.x.toFixed(2)},{' '}
              {position.smooth_position.y.toFixed(2)}) m
            </Text>
            <Text style={styles.statText}>
              raw: ({position.raw_position?.x.toFixed(2)},{' '}
              {position.raw_position?.y.toFixed(2)})
            </Text>
            {position.velocity ? (
              <Text style={styles.statText}>
                velocity: ({position.velocity.vx.toFixed(2)},{' '}
                {position.velocity.vy.toFixed(2)}) m/s
                {speed !== null ? `  ·  speed ${speed.toFixed(2)} m/s` : ''}
              </Text>
            ) : null}
            <Text style={styles.statText}>
              active beacons: {position.active_beacons?.length ?? 0}  ·{' '}
              overlap with fingerprint:{' '}
              {position.overlap_beacons?.length ?? 0}
            </Text>
          </>
        ) : (
          <Text style={styles.statText}>
            {tracking
              ? position?.reason ?? 'waiting for first match…'
              : 'not tracking'}
          </Text>
        )}
      </View>

      {/* Live RSSI diagnostic — the matcher only updates when these
          values change. If this panel is empty or stale, the BLE scan
          is not reaching the backend and the green circle will freeze. */}
      {tracking ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live RSSI</Text>
          <Text style={styles.statText}>
            packets last 250 ms: {eventsSent}  ·  total since start:{' '}
            {eventsSentTotal}
          </Text>
          {fpStatus?.latest_rssi &&
          Object.keys(fpStatus.latest_rssi).length > 0 ? (
            (() => {
              const knownSet = new Set(fpStatus.registered_beacons ?? []);
              const nameById = new Map(
                beaconsRef.current.map(b => [b.id, b.name]),
              );
              const rows = Object.entries(fpStatus.latest_rssi).sort(
                (a, b) => b[1] - a[1],
              );
              return rows.map(([bid, rssi]) => {
                const isKnown = knownSet.has(bid);
                const label = nameById.get(bid) ?? bid;
                return (
                  <View key={bid} style={styles.rssiRow}>
                    <Text
                      style={[
                        styles.rssiName,
                        !isKnown && styles.rssiNameUnknown,
                      ]}
                      numberOfLines={1}>
                      {isKnown ? '●' : '○'} {label}
                    </Text>
                    <Text style={styles.rssiValue}>{rssi.toFixed(1)} dBm</Text>
                  </View>
                );
              });
            })()
          ) : (
            <Text style={styles.statText}>
              no live RSSI yet — make sure beacons are powered on and
              advertising
            </Text>
          )}
          {position?.active_beacons && position.active_beacons.length > 0 &&
          (position.overlap_beacons?.length ?? 0) === 0 ? (
            <Text style={styles.warningInline}>
              Live ids do not match the fingerprint. Check that the
              beacon registry on this phone is the same one used to
              record the survey.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Map */}
      {bbox && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Map</Text>
          <ScrollView horizontal style={styles.svgScroll}>
            <Svg width={svgW} height={svgH}>
              {/* Trail */}
              {trailPoints.length > 0 ? (
                <Polyline
                  points={trailPoints}
                  fill="none"
                  stroke="#3fb950"
                  strokeWidth={2}
                  strokeOpacity={0.6}
                />
              ) : null}

              {/* Raw match position (dim) */}
              {position?.raw_position ? (
                <Circle
                  cx={toSvgX(position.raw_position.x)}
                  cy={toSvgY(position.raw_position.y)}
                  r={5}
                  fill="#d29922"
                  fillOpacity={0.4}
                  stroke="#d29922"
                  strokeWidth={1}
                />
              ) : null}

              {/* Smoothed position (bright) */}
              {position?.smooth_position ? (
                <Circle
                  cx={toSvgX(position.smooth_position.x)}
                  cy={toSvgY(position.smooth_position.y)}
                  r={8}
                  fill="#3fb950"
                  stroke="#0d1117"
                  strokeWidth={2}
                />
              ) : null}

              {/* Beacons */}
              {beacons.map(b => (
                <G key={b.id}>
                  <Circle
                    cx={toSvgX(b.x)}
                    cy={toSvgY(b.y)}
                    r={6}
                    fill="#58a6ff"
                    stroke="#0d1117"
                    strokeWidth={1.5}
                  />
                  <SvgText
                    x={toSvgX(b.x) + 8}
                    y={toSvgY(b.y) - 6}
                    fill="#8b949e"
                    fontSize={8}>
                    {b.name}
                  </SvgText>
                </G>
              ))}
            </Svg>
          </ScrollView>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, {backgroundColor: '#58a6ff'}]} />
            <Text style={styles.legendText}>beacon</Text>
            <View
              style={[
                styles.legendDot,
                {backgroundColor: '#d29922', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>raw match</Text>
            <View
              style={[
                styles.legendDot,
                {backgroundColor: '#3fb950', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>smoothed (KF)</Text>
          </View>
        </View>
      )}

      {/* Top cells (transparency into the matcher) */}
      {position?.top_cells && position.top_cells.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top matching cells</Text>
          {position.top_cells.map((c, i) => (
            <View key={`${c.x},${c.y}`} style={styles.topCellRow}>
              <Text style={styles.topCellRank}>#{i + 1}</Text>
              <Text style={styles.topCellCoord}>
                ({c.x.toFixed(1)}, {c.y.toFixed(1)})
              </Text>
              <View style={styles.topCellBarTrack}>
                <View
                  style={[
                    styles.topCellBarFill,
                    {width: `${Math.round(c.weight * 100)}%`},
                  ]}
                />
              </View>
              <Text style={styles.topCellWeight}>
                d={c.distance.toFixed(1)} · {(c.weight * 100).toFixed(0)}%
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* R (measurement noise) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>R — measurement noise (LOO)</Text>
        {rEstimate ? (
          <>
            <Text style={styles.codeBlock}>{formatMatrix(rEstimate.R)}</Text>
            <Text style={styles.statText}>
              RMSE: {rEstimate.rmse.toFixed(3)} m  ·  n ={' '}
              {rEstimate.n_samples} cells
            </Text>
            <Text style={styles.statText}>
              mean residual: ({rEstimate.mean_residual.x.toFixed(2)},{' '}
              {rEstimate.mean_residual.y.toFixed(2)}) m
            </Text>
          </>
        ) : fpStatus?.R ? (
          <Text style={styles.codeBlock}>{formatMatrix(fpStatus.R)}</Text>
        ) : (
          <Text style={styles.statText}>start tracking to seed R from LOO</Text>
        )}
      </View>

      {/* Q tuning */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Q — process noise tuning</Text>
        <Text style={styles.fieldLabel}>sigma_a (m/s²)</Text>
        <View style={styles.coordsRow}>
          <View style={{flex: 1}}>
            <TextInput
              style={styles.input}
              value={sigmaAInput}
              onChangeText={setSigmaAInput}
              keyboardType="default"
              placeholder="0.5"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={{width: 8}} />
          <TouchableOpacity
            style={[styles.applyButton, !tracking && styles.buttonDisabled]}
            onPress={applySigmaA}
            disabled={!tracking}>
            <Text style={styles.applyButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Higher sigma_a → trust new measurements (snappier, jitterier).
          Lower → trust the motion model (smoother, laggier).
          {fpStatus ? `  Current: ${fpStatus.sigma_a.toFixed(3)}` : ''}
        </Text>
      </View>

      {/* Status footer */}
      {fpStatus ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pipeline status</Text>
          <Text style={styles.statText}>
            R source: {fpStatus.r_source}
          </Text>
          <Text style={styles.statText}>
            cells in fingerprint:{' '}
            {fpStatus.fingerprint_summary?.cell_count ?? '—'}
          </Text>
          <Text style={styles.statText}>
            floor RSSI:{' '}
            {fpStatus.fingerprint_summary?.floor_rssi !== null &&
            fpStatus.fingerprint_summary?.floor_rssi !== undefined
              ? `${fpStatus.fingerprint_summary.floor_rssi.toFixed(2)} dBm`
              : '—'}
          </Text>
          <Text style={styles.statText}>
            registered beacons: {fpStatus.registered_beacons?.length ?? 0}  ·{' '}
            active: {fpStatus.active_beacons?.length ?? 0}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d1117', padding: 16},
  title: {fontSize: 28, fontWeight: '700', color: '#e6edf3', marginBottom: 4},
  subtitle: {fontSize: 13, color: '#8b949e', marginBottom: 16, lineHeight: 18},
  section: {marginBottom: 18},
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  primaryButton: {
    backgroundColor: '#238636',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  primaryButtonText: {color: '#fff', fontWeight: '600'},
  buttonRow: {flexDirection: 'row', gap: 8},
  secondaryButton: {
    flex: 1,
    backgroundColor: '#21262d',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderColor: '#30363d',
    borderWidth: 1,
  },
  secondaryButtonText: {color: '#58a6ff', fontWeight: '500'},
  destructiveButton: {
    flex: 1,
    backgroundColor: '#3a1313',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderColor: '#5f2222',
    borderWidth: 1,
  },
  destructiveButtonText: {color: '#f85149', fontWeight: '500'},
  statusText: {color: '#d29922', marginTop: 8, fontSize: 13},
  bigNumber: {
    color: '#3fb950',
    fontSize: 26,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  statText: {
    color: '#e6edf3',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  svgScroll: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  legendRow: {flexDirection: 'row', alignItems: 'center', marginTop: 8},
  legendDot: {width: 10, height: 10, borderRadius: 5, marginRight: 4},
  legendText: {color: '#8b949e', fontSize: 11},
  topCellRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 6},
  topCellRank: {
    color: '#58a6ff',
    fontSize: 11,
    width: 28,
    fontFamily: 'monospace',
  },
  topCellCoord: {
    color: '#e6edf3',
    fontSize: 12,
    width: 92,
    fontFamily: 'monospace',
  },
  topCellBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#21262d',
    borderRadius: 3,
    overflow: 'hidden',
    marginHorizontal: 6,
  },
  topCellBarFill: {height: 6, backgroundColor: '#1f6feb'},
  topCellWeight: {
    color: '#8b949e',
    fontSize: 11,
    width: 96,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  codeBlock: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginBottom: 4,
    fontWeight: '500',
  },
  coordsRow: {flexDirection: 'row', alignItems: 'flex-end'},
  input: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderColor: '#30363d',
    borderWidth: 1,
    color: '#e6edf3',
    padding: 10,
    fontFamily: 'monospace',
  },
  applyButton: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  applyButtonText: {color: '#fff', fontWeight: '600'},
  buttonDisabled: {opacity: 0.4},
  hint: {
    color: '#6e7681',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  rssiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  rssiName: {
    color: '#e6edf3',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
    marginRight: 8,
  },
  rssiNameUnknown: {
    color: '#d29922',
  },
  rssiValue: {
    color: '#58a6ff',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  warningInline: {
    color: '#f85149',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
    backgroundColor: '#3a1313',
    borderColor: '#5f2222',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
  },
});
