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
import Svg, {Rect, Circle, G, Text as SvgText} from 'react-native-svg';
import {bleScanner} from '../services/bleScanner';
import {api} from '../services/api';
import {loadBeaconConfig, SavedBeacon} from '../config/beaconConfig';

interface Cell {
  x: number;
  y: number;
}

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

// Build a 1 m grid covering the integer bounding box of all configured beacons.
function computeGrid(beacons: SavedBeacon[]): Cell[] {
  if (beacons.length === 0) return [];
  const xs = beacons.map(b => b.x);
  const ys = beacons.map(b => b.y);
  const xMin = Math.floor(Math.min(...xs));
  const xMax = Math.ceil(Math.max(...xs));
  const yMin = Math.floor(Math.min(...ys));
  const yMax = Math.ceil(Math.max(...ys));
  const out: Cell[] = [];
  for (let gx = xMin; gx <= xMax; gx += 1) {
    for (let gy = yMin; gy <= yMax; gy += 1) {
      out.push({x: gx, y: gy});
    }
  }
  return out;
}

export default function SiteSurveyScreen() {
  const [beacons, setBeacons] = useState<SavedBeacon[]>([]);
  const [surveyedCells, setSurveyedCells] = useState<FingerprintCell[]>([]);
  const [floorRssi, setFloorRssi] = useState<number | null>(null);
  const [activeCell, setActiveCell] = useState<Cell | null>(null);
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

  // Keep BLE scan alive while screen is mounted. Subscribe with a no-op
  // listener — raw advertisement events are drained on a timer.
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

  // Reload beacon config + fingerprint state every time the tab is focused
  // so changes made in the Beacons tab show up here without an app restart.
  useFocusEffect(
    useCallback(() => {
      loadBeaconConfig().then(cfg => setBeacons(Object.values(cfg)));
      refreshFingerprint();
    }, [refreshFingerprint]),
  );

  const grid = useMemo(() => computeGrid(beacons), [beacons]);
  const surveyedKey = useMemo(
    () => new Set(surveyedCells.map(c => `${c.x},${c.y}`)),
    [surveyedCells],
  );

  // ── SVG layout ─────────────────────────────────────────────────

  const PADDING = 30;
  const SCALE = 56;

  const bbox = useMemo(() => {
    if (beacons.length === 0) return null;
    const xs = beacons.map(b => b.x);
    const ys = beacons.map(b => b.y);
    return {
      xMin: Math.floor(Math.min(...xs)),
      xMax: Math.ceil(Math.max(...xs)),
      yMin: Math.floor(Math.min(...ys)),
      yMax: Math.ceil(Math.max(...ys)),
    };
  }, [beacons]);

  const svgW = bbox ? (bbox.xMax - bbox.xMin) * SCALE + PADDING * 2 : 240;
  const svgH = bbox ? (bbox.yMax - bbox.yMin) * SCALE + PADDING * 2 : 240;
  const toSvgX = (x: number) => PADDING + (x - (bbox?.xMin ?? 0)) * SCALE;
  // Flip Y so positive y points up, matching the physical layout.
  const toSvgY = (y: number) => svgH - PADDING - (y - (bbox?.yMin ?? 0)) * SCALE;

  // ── Survey lifecycle ───────────────────────────────────────────

  const startSurvey = async () => {
    if (!activeCell) return;
    const target = parseInt(samplesTarget, 10);
    if (!Number.isFinite(target) || target < 1) {
      Alert.alert('Invalid samples target', 'Enter a positive integer.');
      return;
    }
    try {
      const snap = await api.surveyStart(activeCell.x, activeCell.y, target);
      bleScanner.drainRawEvents(); // discard pre-start buffer
      setProgress({active: true, ...snap});
      setStatusMsg(
        `Surveying (${activeCell.x}, ${activeCell.y}) — stand still until full.`,
      );

      // Forward raw advertisements as they arrive.
      flushIntervalRef.current = setInterval(async () => {
        const events = bleScanner.drainRawEvents();
        if (events.length === 0) return;
        try {
          await api.surveyEvents(
            events.map(e => ({beacon_id: e.beacon_id, rssi: e.rssi})),
          );
        } catch {
          // Network blips are non-fatal; next poll will reflect server state.
        }
      }, 400);

      // Poll backend progress (authoritative count of buffered samples).
      pollIntervalRef.current = setInterval(async () => {
        try {
          const p = await api.surveyProgress();
          setProgress(p);
        } catch {}
      }, 500);
    } catch (e: any) {
      Alert.alert('Failed to start survey', e?.message ?? String(e));
    }
  };

  const finalize = async () => {
    stopFlush();
    stopPoll();
    try {
      const expected = beacons.map(b => b.id);
      await api.surveyFinalize(expected);
      setStatusMsg(`Cell (${activeCell?.x}, ${activeCell?.y}) saved.`);
      setActiveCell(null);
      setProgress({active: false});
      await refreshFingerprint();
    } catch (e: any) {
      Alert.alert('Finalize failed', e?.message ?? String(e));
    }
  };

  const cancel = async () => {
    stopFlush();
    stopPoll();
    try {
      await api.surveyCancel();
    } catch {}
    setProgress({active: false});
    setStatusMsg('Survey cancelled.');
  };

  const clearAll = () => {
    Alert.alert(
      'Clear fingerprint?',
      'Removes ALL surveyed cells. Cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.fingerprintClear();
              await refreshFingerprint();
              setActiveCell(null);
              setStatusMsg('Fingerprint cleared.');
            } catch (e: any) {
              Alert.alert('Clear failed', e?.message ?? String(e));
            }
          },
        },
      ],
    );
  };

  const deleteCell = (cell: Cell) => {
    Alert.alert(
      `Delete cell (${cell.x}, ${cell.y})?`,
      'This removes its RSSI distribution from the fingerprint.',
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

  // ── UI bits ───────────────────────────────────────────────────

  const cellOnPress = (cell: Cell) => {
    if (progress.active) return; // can't switch cells mid-survey
    if (surveyedKey.has(`${cell.x},${cell.y}`)) {
      // Already surveyed — offer to delete and resurvey
      Alert.alert(
        `Cell (${cell.x}, ${cell.y}) already surveyed`,
        'Select an action:',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Delete', style: 'destructive', onPress: () => deleteCell(cell)},
          {
            text: 'Resurvey',
            onPress: () => {
              setActiveCell(cell);
            },
          },
        ],
      );
      return;
    }
    setActiveCell(cell);
  };

  const target = progress.samples_target ?? parseInt(samplesTarget, 10) ?? 50;
  const minCount = progress.min_count ?? 0;
  const allFull = minCount >= target;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Site Survey</Text>
      <Text style={styles.subtitle}>
        Stand at each grid point and capture the RSSI distribution from every
        beacon. The fingerprint replaces trilateration in the position
        estimator.
      </Text>

      {beacons.length === 0 ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            No beacons configured. Open the Beacons tab and add anchors first.
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Samples per beacon per cell</Text>
        <TextInput
          style={[styles.input, progress.active && styles.inputDisabled]}
          value={samplesTarget}
          onChangeText={setSamplesTarget}
          keyboardType="number-pad"
          placeholder="50"
          placeholderTextColor="#6e7681"
          editable={!progress.active}
        />
      </View>

      {bbox && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Grid · {surveyedCells.length}/{grid.length} cells surveyed
          </Text>
          <ScrollView horizontal style={styles.svgScroll}>
            <Svg width={svgW} height={svgH}>
              {grid.map(c => {
                const key = `${c.x},${c.y}`;
                const isSurveyed = surveyedKey.has(key);
                const isActive =
                  activeCell && activeCell.x === c.x && activeCell.y === c.y;
                const half = 16;
                let fill = '#21262d';
                if (isSurveyed) fill = '#1f5430';
                if (isActive) fill = '#9e6a03';
                return (
                  <Rect
                    key={key}
                    x={toSvgX(c.x) - half}
                    y={toSvgY(c.y) - half}
                    width={half * 2}
                    height={half * 2}
                    fill={fill}
                    stroke={isActive ? '#d29922' : '#30363d'}
                    strokeWidth={isActive ? 2 : 1}
                    onPress={() => cellOnPress(c)}
                  />
                );
              })}
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
            <View style={[styles.legendSwatch, {backgroundColor: '#21262d'}]} />
            <Text style={styles.legendText}>unsurveyed</Text>
            <View
              style={[
                styles.legendSwatch,
                {backgroundColor: '#9e6a03', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>active</Text>
            <View
              style={[
                styles.legendSwatch,
                {backgroundColor: '#1f5430', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>surveyed</Text>
            <View
              style={[
                styles.legendDot,
                {backgroundColor: '#58a6ff', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>beacon</Text>
          </View>
          <Text style={styles.hint}>
            Tap any cell to select it. Tap a surveyed cell to delete or
            resurvey it.
          </Text>
        </View>
      )}

      {activeCell && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Cell ({activeCell.x}, {activeCell.y})
          </Text>

          {!progress.active ? (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                beacons.length === 0 && styles.buttonDisabled,
              ]}
              onPress={startSurvey}
              disabled={beacons.length === 0}>
              <Text style={styles.primaryButtonText}>
                Start collecting · {samplesTarget} samples / beacon
              </Text>
            </TouchableOpacity>
          ) : (
            <View>
              <Text style={styles.statusText}>{statusMsg}</Text>

              {/* Per-beacon progress bars. Beacons that have not been heard
                  yet at this cell show count = 0 so the user can tell which
                  ones are silent in real time. */}
              {beacons.map(b => {
                const seen = progress.per_beacon?.[b.id]?.count ?? 0;
                const t = progress.samples_target ?? target;
                const pct = Math.min(100, Math.round((seen / Math.max(t, 1)) * 100));
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
                <TouchableOpacity
                  style={[
                    styles.finalizeButton,
                    !allFull && styles.finalizeEarlyButton,
                  ]}
                  onPress={finalize}>
                  <Text style={styles.finalizeButtonText}>
                    {allFull ? 'Finalize' : 'Finalize early'}
                  </Text>
                </TouchableOpacity>
              </View>
              {!allFull && (
                <Text style={styles.hint}>
                  Beacons below target will still be saved with the samples
                  collected so far. Beacons with zero readings will be stored
                  as &quot;not detected&quot; and resolved to the floor RSSI
                  at match time.
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fingerprint summary</Text>
        <Text style={styles.statText}>
          Cells surveyed: {surveyedCells.length}/{grid.length}
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
  input: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderColor: '#30363d',
    borderWidth: 1,
    color: '#e6edf3',
    padding: 10,
    fontFamily: 'monospace',
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
  finalizeButton: {
    flex: 1,
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  finalizeEarlyButton: {backgroundColor: '#9e6a03'},
  finalizeButtonText: {color: '#fff', fontWeight: '600'},
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
