import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  PanResponder,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Svg, {Circle, Line, Polyline, G, Text as SvgText} from 'react-native-svg';
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
  kf_position?: {x: number; y: number};
  smooth_position?: {x: number; y: number};
  constrained_to_path?: boolean;
  velocity?: {vx: number; vy: number};
  active_beacons?: string[];
  overlap_beacons?: string[];
  registered_beacons?: string[];
  top_cells?: TopCell[];
  floor_rssi?: number;
  initialized?: boolean;
}

interface PathSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  const [pathSegments, setPathSegments] = useState<PathSegment[]>([]);
  // Map zoom in px-per-meter. 12 was the previous hard-coded scale; we
  // keep it as the default so the map opens the same as before. The
  // user can pinch via two fingers (Google Maps-style) or use the
  // +/−/Fit buttons.
  const [mapScale, setMapScale] = useState(12);
  // Pan offset (in screen pixels). Applied as a translate transform on
  // the SVG wrapper so dragging is GPU-cheap and doesn't re-render the
  // hundreds of SVG primitives.
  const [pan, setPan] = useState({x: 0, y: 0});
  // Measured viewport for the map container, used by "Fit" to compute
  // the largest scale that still shows the whole bbox at once.
  const [mapViewport, setMapViewport] = useState({width: 0, height: 0});
  // Refs so the PanResponder (created once) can read the current scale
  // and pan WITHOUT re-binding on every change.
  const scaleRef = useRef(mapScale);
  const panRef = useRef(pan);
  useEffect(() => {
    scaleRef.current = mapScale;
  }, [mapScale]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

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

  // Reload beacon list and walkable path on every focus so changes made
  // in the Beacons tab (or via /fp/path) propagate without an app
  // restart.
  useFocusEffect(
    useCallback(() => {
      loadBeaconConfig().then(cfg => {
        const list = Object.values(cfg);
        setBeacons(list);
        beaconsRef.current = list;
      });
      api
        .fpPathGet()
        .then(res => setPathSegments(res?.segments ?? []))
        .catch(() => setPathSegments([]));
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
        // Canonicalise each raw event to a configured beacon and drop
        // anything we don't recognise. Match priority (strongest first):
        //   1. iBeacon (UUID, Major, Minor) from KBeaconPro — stable
        //      across phones and survives a rename.
        //   2. Case-insensitive advertised name match.
        //   3. Direct device.id match (legacy single-phone fallback).
        // Without this filter, neighbouring BCPro devices on other
        // floors would push noise into _latest_rssi.
        const byIBeacon = new Map<string, string>();
        const byNameLower = new Map<string, string>();
        const knownIds = new Set<string>();
        for (const b of beaconsRef.current) {
          knownIds.add(b.id);
          if (b.name) byNameLower.set(b.name.trim().toLowerCase(), b.id);
          if (b.uuid && b.major !== undefined && b.minor !== undefined) {
            byIBeacon.set(
              `${b.uuid.toUpperCase()}|${b.major}|${b.minor}`,
              b.id,
            );
          }
        }
        const filtered = events
          .map(e => {
            let canonicalId: string | undefined;
            if (
              e.ibeacon_uuid &&
              e.ibeacon_major !== null &&
              e.ibeacon_major !== undefined &&
              e.ibeacon_minor !== null &&
              e.ibeacon_minor !== undefined
            ) {
              canonicalId = byIBeacon.get(
                `${e.ibeacon_uuid.toUpperCase()}|${e.ibeacon_major}|${e.ibeacon_minor}`,
              );
            }
            if (!canonicalId && e.beacon_name) {
              canonicalId = byNameLower.get(e.beacon_name.trim().toLowerCase());
            }
            if (!canonicalId && knownIds.has(e.beacon_id)) {
              canonicalId = e.beacon_id;
            }
            if (!canonicalId) return null;
            return {
              beacon_id: canonicalId,
              beacon_name: e.beacon_name,
              rssi: e.rssi,
              ibeacon_uuid: e.ibeacon_uuid ?? null,
              ibeacon_major: e.ibeacon_major ?? null,
              ibeacon_minor: e.ibeacon_minor ?? null,
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);
        if (filtered.length === 0) {
          setEventsSent(0);
          return;
        }
        try {
          await api.fpRssiEvents(filtered);
          setEventsSent(filtered.length);
          eventsSinceLastTickRef.current += filtered.length;
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
    pathSegments.forEach(s => {
      points.push({x: s.x1, y: s.y1});
      points.push({x: s.x2, y: s.y2});
    });
    if (points.length === 0) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
      xMin: Math.floor(Math.min(...xs)) - 2,
      xMax: Math.ceil(Math.max(...xs)) + 2,
      yMin: Math.floor(Math.min(...ys)) - 2,
      yMax: Math.ceil(Math.max(...ys)) + 2,
    };
  }, [beacons, trail, position, pathSegments]);

  const PADDING = 30;
  const MIN_SCALE = 3;
  const MAX_SCALE = 80;
  const svgW = bbox ? (bbox.xMax - bbox.xMin) * mapScale + PADDING * 2 : 240;
  const svgH = bbox ? (bbox.yMax - bbox.yMin) * mapScale + PADDING * 2 : 240;
  const toSvgX = (x: number) => PADDING + (x - (bbox?.xMin ?? 0)) * mapScale;
  const toSvgY = (y: number) =>
    svgH - PADDING - (y - (bbox?.yMin ?? 0)) * mapScale;

  const clampScale = (s: number) =>
    Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  const zoomBy = useCallback((factor: number) => {
    // Zoom around the centre of the viewport. With no measured viewport
    // yet (very first render), just scale without adjusting pan.
    setMapScale(prev => {
      const next = clampScale(prev * factor);
      const ratio = next / prev;
      if (mapViewport.width > 0 && mapViewport.height > 0) {
        const cx = mapViewport.width / 2;
        const cy = mapViewport.height / 2;
        setPan(p => ({
          x: cx - (cx - p.x) * ratio,
          y: cy - (cy - p.y) * ratio,
        }));
      }
      return next;
    });
  }, [mapViewport]);
  const fitToViewport = useCallback(() => {
    if (!bbox || mapViewport.width === 0 || mapViewport.height === 0) return;
    const wMeters = bbox.xMax - bbox.xMin;
    const hMeters = bbox.yMax - bbox.yMin;
    if (wMeters <= 0 || hMeters <= 0) return;
    const fitW = (mapViewport.width - PADDING * 2) / wMeters;
    const fitH = (mapViewport.height - PADDING * 2) / hMeters;
    setMapScale(clampScale(Math.min(fitW, fitH)));
    // Centre the SVG inside the viewport
    setPan({x: 0, y: 0});
  }, [bbox, mapViewport]);

  // ── Two-finger pinch zoom + one-finger pan (Google Maps style) ─

  // Initial state of a gesture, captured on touch-down. All deltas are
  // computed relative to this snapshot, so the gesture remains stable
  // even when React re-renders between move events.
  const gestureRef = useRef<{
    fingers: number;
    // First touch position(s) in page coordinates
    midX: number;
    midY: number;
    // Initial distance between the two fingers (pinch only)
    dist: number;
    // Pan + scale at gesture start
    panX: number;
    panY: number;
    scale: number;
  } | null>(null);

  const pinchDistance = (touches: any[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.hypot(dx, dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      // Become the responder for any touch that starts inside the map.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: evt => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          gestureRef.current = {
            fingers: 2,
            midX: (touches[0].pageX + touches[1].pageX) / 2,
            midY: (touches[0].pageY + touches[1].pageY) / 2,
            dist: pinchDistance(touches),
            panX: panRef.current.x,
            panY: panRef.current.y,
            scale: scaleRef.current,
          };
        } else if (touches.length === 1) {
          gestureRef.current = {
            fingers: 1,
            midX: touches[0].pageX,
            midY: touches[0].pageY,
            dist: 0,
            panX: panRef.current.x,
            panY: panRef.current.y,
            scale: scaleRef.current,
          };
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const initial = gestureRef.current;
        if (!initial) return;
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          // Re-seed if the user added a finger mid-gesture so the
          // pinch starts smoothly from the new midpoint/distance.
          if (initial.fingers !== 2) {
            gestureRef.current = {
              fingers: 2,
              midX: (touches[0].pageX + touches[1].pageX) / 2,
              midY: (touches[0].pageY + touches[1].pageY) / 2,
              dist: pinchDistance(touches),
              panX: panRef.current.x,
              panY: panRef.current.y,
              scale: scaleRef.current,
            };
            return;
          }
          const currentDist = pinchDistance(touches);
          if (initial.dist <= 0) return;
          const newScale = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, initial.scale * (currentDist / initial.dist)),
          );
          const ratio = newScale / initial.scale;
          // Zoom anchored at the initial midpoint between the two
          // fingers — same feel as Google Maps. The midpoint stays
          // pinned to the same screen pixel as scale changes.
          const newPanX = initial.midX - (initial.midX - initial.panX) * ratio;
          const newPanY = initial.midY - (initial.midY - initial.panY) * ratio;
          setMapScale(newScale);
          setPan({x: newPanX, y: newPanY});
        } else if (touches.length === 1 && initial.fingers === 1) {
          // 1-finger pan: translate by the gesture delta from start.
          setPan({
            x: initial.panX + gestureState.dx,
            y: initial.panY + gestureState.dy,
          });
        }
      },

      onPanResponderRelease: () => {
        gestureRef.current = null;
      },
      onPanResponderTerminate: () => {
        gestureRef.current = null;
      },
    }),
  ).current;

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
          <View style={styles.mapHeaderRow}>
            <Text style={styles.sectionTitle}>Map</Text>
            <View style={styles.zoomBar}>
              <TouchableOpacity
                onPress={() => zoomBy(1 / 1.4)}
                style={[
                  styles.zoomButton,
                  mapScale <= MIN_SCALE + 1e-6 && styles.zoomButtonDisabled,
                ]}
                disabled={mapScale <= MIN_SCALE + 1e-6}>
                <Text style={styles.zoomButtonText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={fitToViewport}
                style={styles.zoomFitButton}>
                <Text style={styles.zoomFitText}>Fit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => zoomBy(1.4)}
                style={[
                  styles.zoomButton,
                  mapScale >= MAX_SCALE - 1e-6 && styles.zoomButtonDisabled,
                ]}
                disabled={mapScale >= MAX_SCALE - 1e-6}>
                <Text style={styles.zoomButtonText}>+</Text>
              </TouchableOpacity>
              <Text style={styles.zoomScaleLabel}>
                {mapScale.toFixed(1)} px/m
              </Text>
            </View>
          </View>
          {/* Pinch-zoom + drag-pan, Google Maps style. Two fingers
              zoom around their midpoint; one finger pans. The SVG is
              clipped to this fixed-height viewport. */}
          <View
            style={styles.svgScroll}
            onLayout={e => {
              const {width, height} = e.nativeEvent.layout;
              setMapViewport({width, height});
            }}
            {...panResponder.panHandlers}>
            <View
              pointerEvents="none"
              style={{
                transform: [
                  {translateX: pan.x},
                  {translateY: pan.y},
                ],
              }}>
              <Svg width={svgW} height={svgH}>
              {/* Walkable path — drawn beneath everything else so the
                  beacons / position circles read on top. */}
              {pathSegments.map((s, i) => (
                <Line
                  key={`seg-${i}`}
                  x1={toSvgX(s.x1)}
                  y1={toSvgY(s.y1)}
                  x2={toSvgX(s.x2)}
                  y2={toSvgY(s.y2)}
                  stroke="#30363d"
                  strokeWidth={14}
                  strokeLinecap="round"
                  strokeOpacity={0.55}
                />
              ))}

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

              {/* Unconstrained KF output — only shown when it actually
                  differs from the projected position (i.e. the user
                  has a path constraint configured). */}
              {position?.constrained_to_path && position.kf_position ? (
                <Circle
                  cx={toSvgX(position.kf_position.x)}
                  cy={toSvgY(position.kf_position.y)}
                  r={4}
                  fill="none"
                  stroke="#8b949e"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
              ) : null}

              {/* Smoothed position (bright, path-constrained when on) */}
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
            </View>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, {backgroundColor: '#58a6ff'}]} />
            <Text style={styles.legendText}>beacon</Text>
            <View
              style={[
                styles.legendBar,
                {backgroundColor: '#30363d', marginLeft: 12},
              ]}
            />
            <Text style={styles.legendText}>walkable path</Text>
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
            <Text style={styles.legendText}>
              {position?.constrained_to_path
                ? 'KF → path'
                : 'smoothed (KF)'}
            </Text>
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
    // Cap the visible height — the PanResponder handles panning and
    // pinching beyond the viewport edges.
    height: 360,
    // Clip the translated SVG to the viewport rectangle.
    overflow: 'hidden',
  },
  mapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  zoomBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoomButton: {
    width: 32,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#21262d',
    borderColor: '#30363d',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  zoomButtonDisabled: {opacity: 0.35},
  zoomButtonText: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 18,
  },
  zoomFitButton: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#21262d',
    borderColor: '#30363d',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  zoomFitText: {color: '#58a6ff', fontSize: 12, fontWeight: '600'},
  zoomScaleLabel: {
    color: '#6e7681',
    fontSize: 10,
    fontFamily: 'monospace',
    marginLeft: 8,
    minWidth: 56,
    textAlign: 'right',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
  },
  legendDot: {width: 10, height: 10, borderRadius: 5, marginRight: 4},
  legendBar: {width: 16, height: 4, borderRadius: 2, marginRight: 4},
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
