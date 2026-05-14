import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {bleScanner} from '../services/bleScanner';
import {api, PipelineBeaconSetup} from '../services/api';
import {loadBeaconConfig} from '../config/beaconConfig';

interface PositionData {
  distances: Record<string, number>;
  raw_position: {x: number; y: number};
  smooth_position: {x: number; y: number};
  converged: boolean;
  active_beacons?: string[];
}

const RSSI_FLUSH_INTERVAL_MS = 250;
const POSITION_POLL_INTERVAL_MS = 500;

export default function PositionScreen() {
  const [tracking, setTracking] = useState(false);
  const [positionData, setPositionData] = useState<PositionData | null>(null);
  const [converged, setConverged] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [activeBeacons, setActiveBeacons] = useState<string[]>([]);

  const rssiFlushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const positionPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const stopAllIntervals = useCallback(() => {
    if (rssiFlushIntervalRef.current) {
      clearInterval(rssiFlushIntervalRef.current);
      rssiFlushIntervalRef.current = null;
    }
    if (positionPollIntervalRef.current) {
      clearInterval(positionPollIntervalRef.current);
      positionPollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    loadPipelineStatus();
    loadBeaconConfig();

    // Keep at least one subscriber alive so the underlying BLE scan
    // doesn't shut down when other screens unmount. The callback is a
    // no-op — raw events are pulled via bleScanner.drainRawEvents().
    const unsub = bleScanner.subscribe(() => {});

    return () => {
      stopAllIntervals();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPipelineStatus = async () => {
    try {
      const status = await api.pipelineStatus();
      setConverged(status.converged ?? false);
    } catch {
      // Backend may not be reachable yet — leave defaults in place.
    }
  };

  const startTracking = useCallback(async () => {
    setError('');
    setStatusMsg('Setting up pipeline...');
    setPositionData(null);

    // 1. Read beacon coordinates from local storage (Beacons tab).
    //    Each beacon may carry its own 1D Kalman q/r — measured by the
    //    RSSI Profile screen (auto-saved) or entered by hand on the
    //    Beacons tab. Beacons without q/r fall back to the backend's
    //    global default; we surface a warning for those.
    const config = await loadBeaconConfig();
    const beacons: PipelineBeaconSetup[] = Object.values(config).map(b => {
      const hasQR =
        typeof b.q === 'number' &&
        Number.isFinite(b.q) &&
        typeof b.r === 'number' &&
        Number.isFinite(b.r);
      return {
        id: b.id,
        name: b.name,
        x: b.x,
        y: b.y,
        ...(hasQR ? {q: b.q, r: b.r} : {}),
      };
    });

    if (beacons.length < 3) {
      setError(
        `Configure at least 3 beacons in the Beacons tab (currently ${beacons.length}).`,
      );
      setStatusMsg('');
      return;
    }

    const beaconsMissingKalman = beacons
      .filter(b => b.q === undefined || b.r === undefined)
      .map(b => b.name);

    // 2. Register beacons with the backend pipeline. This wipes any
    //    previously registered beacons and resets the median window so
    //    each tracking session starts cold.
    try {
      await api.pipelineSetup(beacons, {resetPositionFilter: true});
    } catch (err: any) {
      setError(`Pipeline setup failed: ${err.message}`);
      setStatusMsg('');
      return;
    }

    // 3. Discard any raw events buffered before tracking started so
    //    we don't replay stale RSSI from previous sessions.
    bleScanner.drainRawEvents();

    setTracking(true);
    if (beaconsMissingKalman.length > 0) {
      setStatusMsg(
        `Tracking — using global Q/R default for ${beaconsMissingKalman.length} beacon(s): ${beaconsMissingKalman.join(', ')}. Run the RSSI Profile tab on each to use per-beacon noise values.`,
      );
    } else {
      setStatusMsg('Tracking — streaming RSSI (per-beacon Q/R applied)...');
    }

    // 4. Stream raw RSSI events at high frequency (per-beacon stage 1
    //    Kalman filtering happens server-side inside the pipeline).
    rssiFlushIntervalRef.current = setInterval(async () => {
      const events = bleScanner.drainRawEvents();
      if (events.length === 0) return;
      try {
        await api.pipelineRssiEvents(
          events.map(e => ({beacon_id: e.beacon_id, rssi: e.rssi})),
        );
      } catch {
        // Network blips are common during tracking; keep trying.
      }
    }, RSSI_FLUSH_INTERVAL_MS);

    // 5. Poll for the current smoothed position (stage 2 median filter runs on
    //    every call, on top of the latest filtered RSSI per beacon).
    positionPollIntervalRef.current = setInterval(async () => {
      try {
        const result = await api.pipelineLatestPosition();
        if (!result.ready) {
          setStatusMsg(result.reason ?? 'Waiting for beacons...');
          setActiveBeacons(result.active_beacons ?? []);
          return;
        }
        setPositionData(result);
        setConverged(result.converged ?? false);
        setActiveBeacons(result.active_beacons ?? []);
        setStatusMsg('');
        setError('');
      } catch (err: any) {
        setError(err.message);
      }
    }, POSITION_POLL_INTERVAL_MS);
  }, []);

  const stopTracking = useCallback(() => {
    setTracking(false);
    stopAllIntervals();
    bleScanner.drainRawEvents(); // drop unsent buffer
    setStatusMsg('Tracking stopped.');
  }, [stopAllIntervals]);

  const handleReset = useCallback(async () => {
    try {
      await api.pipelineReset();
      setPositionData(null);
      setConverged(false);
      setActiveBeacons([]);
      setStatusMsg('Pipeline reset (per-beacon RSSI KFs + median window).');
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const rawPos = positionData?.raw_position;
  const smoothPos = positionData?.smooth_position;

  let diffX: number | null = null;
  let diffY: number | null = null;
  if (rawPos && smoothPos) {
    diffX = Math.abs(rawPos.x - smoothPos.x);
    diffY = Math.abs(rawPos.y - smoothPos.y);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Position</Text>
      <Text style={styles.subtitle}>
        Per-beacon RSSI Kalman → weighted trilateration → median filter
      </Text>

      <TouchableOpacity
        style={[
          styles.button,
          tracking ? styles.buttonStop : styles.buttonStart,
        ]}
        onPress={tracking ? stopTracking : startTracking}>
        <Text style={styles.buttonText}>
          {tracking ? 'Stop Tracking' : 'Start Tracking'}
        </Text>
      </TouchableOpacity>

      {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}
      {error ? <Text style={styles.errorMsg}>{error}</Text> : null}

      {tracking ? (
        <Text style={styles.statusMsg}>
          Active beacons: {activeBeacons.length}
          {activeBeacons.length > 0 ? ` — ${activeBeacons.join(', ')}` : ''}
        </Text>
      ) : null}

      {positionData ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Distances</Text>
            {Object.entries(positionData.distances).map(([name, dist]) => (
              <View key={name} style={styles.row}>
                <Text style={styles.rowLabel}>{name}:</Text>
                <Text style={styles.rowValue}>{dist.toFixed(4)} m</Text>
              </View>
            ))}
          </View>

          <View style={styles.positionRow}>
            <View style={[styles.positionCard, styles.positionCardRaw]}>
              <Text style={styles.positionLabel}>Raw Position</Text>
              <Text style={styles.positionCoord}>
                x: {rawPos?.x.toFixed(4)}
              </Text>
              <Text style={styles.positionCoord}>
                y: {rawPos?.y.toFixed(4)}
              </Text>
            </View>
            <View style={[styles.positionCard, styles.positionCardSmooth]}>
              <Text style={styles.positionLabel}>Smooth Position</Text>
              <Text style={styles.positionCoord}>
                x: {smoothPos?.x.toFixed(4)}
              </Text>
              <Text style={styles.positionCoord}>
                y: {smoothPos?.y.toFixed(4)}
              </Text>
            </View>
          </View>

          {diffX !== null && diffY !== null ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Median Filter Effect (|raw - smooth|)
              </Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Δx:</Text>
                <Text style={styles.rowValueHighlight}>
                  {diffX.toFixed(4)} m
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Δy:</Text>
                <Text style={styles.rowValueHighlight}>
                  {diffY.toFixed(4)} m
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Filter Status</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Converged:</Text>
              <Text
                style={[
                  styles.rowValue,
                  {color: converged ? '#3fb950' : '#f0883e'},
                ]}>
                {converged ? 'YES' : 'NO'}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      <TouchableOpacity style={styles.buttonDanger} onPress={handleReset}>
        <Text style={styles.buttonText}>Reset Pipeline Filters</Text>
      </TouchableOpacity>

      <View style={{height: 40}} />
    </ScrollView>
  );
}

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
    marginBottom: 16,
  },
  button: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonStart: {backgroundColor: '#238636'},
  buttonStop: {backgroundColor: '#da3633'},
  buttonDanger: {
    backgroundColor: '#da3633',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusMsg: {
    fontSize: 14,
    color: '#8b949e',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  errorMsg: {
    fontSize: 14,
    color: '#f85149',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabel: {
    fontSize: 14,
    color: '#8b949e',
  },
  rowValue: {
    fontSize: 14,
    color: '#e6edf3',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  rowValueHighlight: {
    fontSize: 14,
    color: '#d2a8ff',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  positionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  positionCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  positionCardRaw: {
    backgroundColor: '#1c1917',
    borderColor: '#f0883e',
  },
  positionCardSmooth: {
    backgroundColor: '#0d2818',
    borderColor: '#238636',
  },
  positionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e6edf3',
    marginBottom: 8,
  },
  positionCoord: {
    fontSize: 16,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 2,
  },
});
