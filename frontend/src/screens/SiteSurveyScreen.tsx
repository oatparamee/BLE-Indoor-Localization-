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
import Svg, {Rect, Circle, G, Text as SvgText, Line as SvgLine} from 'react-native-svg';
import {bleScanner} from '../services/bleScanner';
import {api} from '../services/api';
import {loadBeaconConfig, SavedBeacon} from '../config/beaconConfig';

interface CellBeaconStats {
  n: number;
  mean: number;
  var: number;
  std: number;
  min: number;
  max: number;
}

interface FingerprintCell {
  x: number;
  y: number;
  timestamp: number;
  beacons: Record<string, CellBeaconStats | null>;
}

interface SurveyProgress {
  active?: boolean;
  x?: number;
  y?: number;
  samples_target?: number;
  per_beacon?: Record<string, {count: number; target: number}>;
  min_count?: number;
  max_count?: number;
}

export default function SiteSurveyScreen() {
  const [beacons, setBeacons] = useState<SavedBeacon[]>([]);
  const [surveyedCells, setSurveyedCells] = useState<FingerprintCell[]>([]);
  const [floorRssi, setFloorRssi] = useState<number | null>(null);

  const [xInput, setXInput] = useState('');
  const [yInput, setYInput] = useState('');
  const [samplesTarget, setSamplesTarget] = useState('50');

  const [progress, setProgress] = useState<SurveyProgress>({active: false});
  const [statusMsg, setStatusMsg] = useState('');

  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const stopFlush = useCallback(() => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
  }, []);
  const stopPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const refreshFingerprint = useCallback(async () => {
    try {
      const result = await api.fingerprintCells();
      setSurveyedCells(result.cells || []);
      setFloorRssi(
        typeof result.summary?.floor_rssi === 'number'
          ? result.summary.floor_rssi
          : null,
      );
    } catch (e: any) {
      console.warn('fingerprint refresh failed', e?.message ?? e);
    }
  }, []);

  // Keep BLE scan alive while screen is mounted.
  useEffect(() => {
    unsubRef.current = bleScanner.subscribe(() => {});
    return () => {
      stopFlush();
      stopPoll();
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [stopFlush, stopPoll]);

  // Refresh beacons + fingerprint state each time the tab is focused.
  useFocusEffect(
    useCallback(() => {
      loadBeaconConfig().then(cfg => setBeacons(Object.values(cfg)));
      refreshFingerprint();
    }, [refreshFingerprint]),
  );

  const parseCoord = (s: string): number | null => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };

  const x = parseCoord(xInput);
  const y = parseCoord(yInput);
  const coordsValid = x !== null && y !== null;

  // ── Survey lifecycle ───────────────────────────────────────────

  const startSurvey = async () => {
    if (!coordsValid) {
      Alert.alert('Invalid coordinates', 'Enter numeric x and y values.');
      return;
    }
    const target = parseInt(samplesTarget, 10);
    if (!Number.isFinite(target) || target < 1) {
      Alert.alert('Invalid samples target', 'Enter a positive integer.');
      return;
    }

    // Warn if this exact point is already surveyed.
    const existing = surveyedCells.find(c => c.x === x && c.y === y);
    if (existing) {
      Alert.alert(
        `Point (${x}, ${y}) already surveyed`,
        'Saving will overwrite the existing distribution. Continue?',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Overwrite', style: 'destructive', onPress: () => doStart(target)},
        ],
      );
      return;
    }
    doStart(target);
  };

  const doStart = async (target: number) => {
    try {
      const snap = await api.surveyStart(x as number, y as number, target);
      bleScanner.drainRawEvents();
      setProgress({active: true, ...snap});
      setStatusMsg(`Collecting at (${x}, ${y}) — stand still.`);

      flushIntervalRef.current = setInterval(async () => {
        const events = bleScanner.drainRawEvents();
        if (events.length === 0) return;
        try {
          await api.surveyEvents(
            events.map(e => ({beacon_id: e.beacon_id, rssi: e.rssi})),
          );
        } catch {}
      }, 400);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const p = await api.surveyProgress();
          setProgress(p);
        } catch {}
      }, 500);
    } catch (e: any) {
      Alert.alert('Failed to start', e?.message ?? String(e));
    }
  };

  const savePoint = async () => {
    stopFlush();
    stopPoll();
    try {
      const expected = beacons.map(b => b.id);
      await api.surveyFinalize(expected);
      setStatusMsg(`Saved (${x}, ${y}).`);
      setProgress({active: false});
      await refreshFingerprint();
      // Keep the x/y inputs as-is so the user can quickly edit just one
      // axis for the next nearby point.
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? String(e));
    }
  };

  const cancel = async () => {
    stopFlush();
    stopPoll();
    try {
      await api.surveyCancel();
    } catch {}
    setProgress({active: false});
    setStatusMsg('Cancelled.');
  };

  const deletePoint = (cell: FingerprintCell) => {
    Alert.alert(
      `Delete (${cell.x}, ${cell.y})?`,
      'Removes this point\'s distribution from the fingerprint.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.fingerprintDeleteCell(cell.x, cell.y);
              await refreshFingerprint();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message ?? String(e));
            }
          },
        },
      ],
    );
  };

  const clearAll = () => {
    Alert.alert(
      'Clear fingerprint?',
      'Removes ALL surveyed points. Cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.fingerprintClear();
              await refreshFingerprint();
              setStatusMsg('Fingerprint cleared.');
            } catch (e: any) {
              Alert.alert('Clear failed', e?.message ?? String(e));
            }
          },
        },
      ],
    );
  };

  // ── SVG layout ─────────────────────────────────────────────────

  const PADDING = 30;
  const SCALE = 50;

  const bbox = useMemo(() => {
    const points: {x: number; y: number}[] = [...beacons];
    surveyedCells.forEach(c => points.push({x: c.x, y: c.y}));
    if (coordsValid) points.push({x: x as number, y: y as number});
    if (points.length === 0) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    // Add 1 m of margin so corner points aren't flush with the edge.
    return {
      xMin: Math.floor(Math.min(...xs)) - 1,
      xMax: Math.ceil(Math.max(...xs)) + 1,
      yMin: Math.floor(Math.min(...ys)) - 1,
      yMax: Math.ceil(Math.max(...ys)) + 1,
    };
  }, [beacons, surveyedCells, x, y, coordsValid]);

  const svgW = bbox ? (bbox.xMax - bbox.xMin) * SCALE + PADDING * 2 : 240;
  const svgH = bbox ? (bbox.yMax - bbox.yMin) * SCALE + PADDING * 2 : 240;
  const toSvgX = (px: number) => PADDING + (px - (bbox?.xMin ?? 0)) * SCALE;
  const toSvgY = (py: number) =>
    svgH - PADDING - (py - (bbox?.yMin ?? 0)) * SCALE;

  // Generate integer 1 m gridlines for the visual reference.
  const gridLines = useMemo(() => {
    if (!bbox) return {vertical: [], horizontal: []};
    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (let gx = bbox.xMin; gx <= bbox.xMax; gx += 1) vertical.push(gx);
    for (let gy = bbox.yMin; gy <= bbox.yMax; gy += 1) horizontal.push(gy);
    return {vertical, horizontal};
  }, [bbox]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Site Survey</Text>
      <Text style={styles.subtitle}>
        Type the (x, y) coordinate where you&apos;re standing, collect the
        RSSI distribution, and save the point. Repeat for every location
        you want in the fingerprint.
      </Text>

      {beacons.length === 0 ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            No beacons configured. Open the Beacons tab and add anchors first.
          </Text>
        </View>
      ) : null}

      {/* Coordinate input */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Point coordinates</Text>
        <View style={styles.coordsRow}>
          <View style={{flex: 1}}>
            <Text style={styles.fieldLabel}>x (meters)</Text>
            <TextInput
              style={[styles.input, progress.active && styles.inputDisabled]}
              value={xInput}
              onChangeText={setXInput}
              keyboardType="default"
              placeholder="0.0"
              placeholderTextColor="#6e7681"
              editable={!progress.active}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={{width: 12}} />
          <View style={{flex: 1}}>
            <Text style={styles.fieldLabel}>y (meters)</Text>
            <TextInput
              style={[styles.input, progress.active && styles.inputDisabled]}
              value={yInput}
              onChangeText={setYInput}
              keyboardType="default"
              placeholder="0.0"
              placeholderTextColor="#6e7681"
              editable={!progress.active}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Samples per beacon</Text>
        <TextInput
          style={[styles.input, progress.active && styles.inputDisabled]}
          value={samplesTarget}
          onChangeText={setSamplesTarget}
          keyboardType="number-pad"
          placeholder="50"
          placeholderTextColor="#6e7681"
          editable={!progress.active}
        />

        {!progress.active ? (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!coordsValid || beacons.length === 0) && styles.buttonDisabled,
            ]}
            onPress={startSurvey}
            disabled={!coordsValid || beacons.length === 0}>
            <Text style={styles.primaryButtonText}>Start collecting</Text>
          </TouchableOpacity>
        ) : (
          <View>
            <Text style={styles.statusText}>{statusMsg}</Text>
            {beacons.map(b => {
              const seen = progress.per_beacon?.[b.id]?.count ?? 0;
              const t = progress.samples_target ?? 50;
              const pct = Math.min(
                100,
                Math.round((seen / Math.max(t, 1)) * 100),
              );
              return (
                <View key={b.id} style={styles.barRow}>
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, {width: `${pct}%`}]} />
                  </View>
                  <Text style={styles.barCount}>
                    {seen}/{t}
                  </Text>
                </View>
              );
            })}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={cancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={savePoint}>
                <Text style={styles.saveButtonText}>Save point</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              You can save early — beacons below target keep what they have;
              silent beacons get stored as &quot;not detected&quot;.
            </Text>
          </View>
        )}
      </View>

      {/* Map visualization */}
      {bbox && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Map · {surveyedCells.length} point{surveyedCells.length === 1 ? '' : 's'} surveyed
          </Text>
          <ScrollView horizontal style={styles.svgScroll}>
            <Svg width={svgW} height={svgH}>
              {/* Reference 1 m gridlines */}
              {gridLines.vertical.map(gx => (
                <SvgLine
                  key={`v${gx}`}
                  x1={toSvgX(gx)}
                  y1={PADDING / 2}
                  x2={toSvgX(gx)}
                  y2={svgH - PADDING / 2}
                  stroke="#21262d"
                  strokeWidth={1}
                />
              ))}
              {gridLines.horizontal.map(gy => (
                <SvgLine
                  key={`h${gy}`}
                  x1={PADDING / 2}
                  y1={toSvgY(gy)}
                  x2={svgW - PADDING / 2}
                  y2={toSvgY(gy)}
                  stroke="#21262d"
                  strokeWidth={1}
                />
              ))}

              {/* Surveyed points */}
              {surveyedCells.map(c => (
                <G key={`c${c.x},${c.y}`}>
                  <Rect
                    x={toSvgX(c.x) - 10}
                    y={toSvgY(c.y) - 10}
                    width={20}
                    height={20}
                    fill="#1f5430"
                    stroke="#3fb950"
                    strokeWidth={1}
                    onPress={() => deletePoint(c)}
                  />
                  <SvgText
                    x={toSvgX(c.x)}
                    y={toSvgY(c.y) + 22}
                    fill="#8b949e"
                    fontSize={9}
                    textAnchor="middle">
                    ({c.x},{c.y})
                  </SvgText>
                </G>
              ))}

              {/* Pending point (from typed input) */}
              {coordsValid && (
                <Circle
                  cx={toSvgX(x as number)}
                  cy={toSvgY(y as number)}
                  r={9}
                  fill="#d2992233"
                  stroke="#d29922"
                  strokeWidth={2}
                />
              )}

              {/* Beacon anchors */}
              {beacons.map(b => (
                <G key={b.id}>
                  <Circle
                    cx={toSvgX(b.x)}
                    cy={toSvgY(b.y)}
                    r={8}
                    fill="#58a6ff"
                    stroke="#0d1117"
                    strokeWidth={2}
                  />
                  <SvgText
                    x={toSvgX(b.x) + 12}
                    y={toSvgY(b.y) - 8}
                    fill="#e6edf3"
                    fontSize={10}>
                    {b.name}
                  </SvgText>
                </G>
              ))}
            </Svg>
          </ScrollView>
          <View style={styles.legendRow}>
            <View style={[styles.legendSwatch, {backgroundColor: '#1f5430'}]} />
            <Text style={styles.legendText}>saved point</Text>
            <View
              style={[
                styles.legendDot,
                {backgroundColor: '#d29922', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>pending</Text>
            <View
              style={[
                styles.legendDot,
                {backgroundColor: '#58a6ff', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>beacon</Text>
          </View>
          <Text style={styles.hint}>
            Tap a saved point to delete it.
          </Text>
        </View>
      )}

      {/* Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fingerprint summary</Text>
        <Text style={styles.statText}>
          Points surveyed: {surveyedCells.length}
        </Text>
        <Text style={styles.statText}>
          Beacons in fingerprint:{' '}
          {(() => {
            const ids = new Set<string>();
            for (const c of surveyedCells) {
              for (const bid of Object.keys(c.beacons || {})) ids.add(bid);
            }
            return ids.size;
          })()}
        </Text>
        <Text style={styles.statText}>
          Floor RSSI:{' '}
          {floorRssi !== null
            ? `${floorRssi.toFixed(2)} dBm`
            : '— (no data yet)'}
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={refreshFingerprint}>
            <Text style={styles.secondaryButtonText}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.destructiveButton}
            onPress={clearAll}>
            <Text style={styles.destructiveButtonText}>Clear All</Text>
          </TouchableOpacity>
        </View>
      </View>

      {statusMsg && !progress.active ? (
        <Text style={styles.bottomStatus}>{statusMsg}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d1117', padding: 16},
  title: {fontSize: 28, fontWeight: '700', color: '#e6edf3', marginBottom: 4},
  subtitle: {fontSize: 14, color: '#8b949e', marginBottom: 16, lineHeight: 20},
  section: {marginBottom: 18},
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  warning: {
    backgroundColor: '#3a2a13',
    borderColor: '#bb8009',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  warningText: {color: '#d29922', fontSize: 13},
  coordsRow: {flexDirection: 'row', marginBottom: 8},
  fieldLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderColor: '#30363d',
    borderWidth: 1,
    color: '#e6edf3',
    padding: 10,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  inputDisabled: {opacity: 0.5},
  svgScroll: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  legendRow: {flexDirection: 'row', alignItems: 'center', marginTop: 8},
  legendSwatch: {width: 12, height: 12, borderRadius: 2, marginRight: 4},
  legendDot: {width: 10, height: 10, borderRadius: 5, marginRight: 4},
  legendText: {color: '#8b949e', fontSize: 11},
  hint: {
    color: '#6e7681',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: '#238636',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {color: '#fff', fontWeight: '600'},
  buttonDisabled: {opacity: 0.4},
  statusText: {color: '#d29922', marginBottom: 10, fontSize: 13},
  barRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 6},
  barLabel: {
    color: '#e6edf3',
    fontSize: 12,
    width: 96,
    fontFamily: 'monospace',
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#21262d',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  barFill: {height: 8, backgroundColor: '#3fb950'},
  barCount: {
    color: '#8b949e',
    fontSize: 11,
    width: 64,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  buttonRow: {flexDirection: 'row', marginTop: 12, gap: 8},
  cancelButton: {
    flex: 1,
    backgroundColor: '#21262d',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderColor: '#30363d',
    borderWidth: 1,
  },
  cancelButtonText: {color: '#e6edf3', fontWeight: '600'},
  saveButton: {
    flex: 1,
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  saveButtonText: {color: '#fff', fontWeight: '600'},
  statText: {
    color: '#e6edf3',
    fontSize: 13,
    marginBottom: 4,
    fontFamily: 'monospace',
  },
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
  bottomStatus: {
    color: '#3fb950',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
