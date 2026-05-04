import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import {bleScanner, BeaconReading} from '../services/bleScanner';
import {api, PositionBeaconInput} from '../services/api';
import {loadBeaconConfig, getBeaconConfig} from '../config/beaconConfig';

interface PositionData {
  distances: Record<string, number>;
  raw_position: {x: number; y: number};
  smooth_position: {x: number; y: number};
  converged: boolean;
}

export default function PositionScreen() {
  const [tracking, setTracking] = useState(false);
  const [positionData, setPositionData] = useState<PositionData | null>(null);
  const [qValue, setQValue] = useState(0.01);
  const [rValue, setRValue] = useState(1.0);
  const [qInput, setQInput] = useState('0.01');
  const [rInput, setRInput] = useState('1');
  const [converged, setConverged] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const readingsRef = useRef<Record<string, BeaconReading>>({});
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadKalmanStatus();
    loadBeaconConfig();

    const unsub = bleScanner.subscribe(newReadings => {
      readingsRef.current = newReadings;
    });

    return () => {
      if (positionIntervalRef.current) {
        clearInterval(positionIntervalRef.current);
        positionIntervalRef.current = null;
      }
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadKalmanStatus = async () => {
    try {
      const status = await api.kalmanStatus();
      const q = status.q_value ?? 0.01;
      const r = status.r_current ?? 1.0;
      setQValue(q);
      setRValue(r);
      setQInput(String(q));
      setRInput(String(r));
      setConverged(status.converged ?? false);
    } catch {
      // Backend may not be reachable yet
    }
  };

  const startTracking = useCallback(async () => {
    setTracking(true);
    setError('');
    setStatusMsg('Tracking...');

    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
    }

    positionIntervalRef.current = setInterval(async () => {
      const readings = readingsRef.current;
      const config = getBeaconConfig();
      const beaconsPayload: PositionBeaconInput[] = [];

      for (const [id, reading] of Object.entries(readings)) {
        const cfg = config[id];
        if (!cfg || !reading.active || reading.smoothedRssi === null) {
          continue;
        }
        beaconsPayload.push({
          id,
          name: cfg.name,
          x: cfg.x,
          y: cfg.y,
          rssi: reading.smoothedRssi,
        });
      }

      if (beaconsPayload.length < 3) {
        setStatusMsg(
          `Waiting for beacons — ${beaconsPayload.length}/3 active. ` +
            'Configure beacons in the Beacons tab.',
        );
        return;
      }

      try {
        const result = await api.positionWithBeacons(beaconsPayload);
        if (result.error) {
          setError(result.error);
          setStatusMsg('');
          return;
        }
        setPositionData(result);
        setConverged(result.converged ?? false);
        setError('');
        setStatusMsg('');
      } catch (err: any) {
        setError(err.message);
      }
    }, 1000);
  }, []);

  const stopTracking = useCallback(() => {
    setTracking(false);
    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
      positionIntervalRef.current = null;
    }
    setStatusMsg('Tracking stopped.');
  }, []);

  const handleQChange = useCallback(async (value: number) => {
    setQValue(value);
    setQInput(String(value));
    try {
      await api.kalmanUpdate({Q: value});
    } catch {}
  }, []);

  const handleRChange = useCallback(async (value: number) => {
    setRValue(value);
    setRInput(String(value));
    try {
      await api.kalmanUpdate({R: value});
    } catch {}
  }, []);

  const applyQInput = useCallback(async () => {
    const parsed = Number(qInput.trim());
    if (!Number.isFinite(parsed)) {
      setError('Q must be a valid number.');
      return;
    }
    setError('');
    await handleQChange(parsed);
  }, [handleQChange, qInput]);

  const applyRInput = useCallback(async () => {
    const parsed = Number(rInput.trim());
    if (!Number.isFinite(parsed)) {
      setError('R must be a valid number.');
      return;
    }
    setError('');
    await handleRChange(parsed);
  }, [handleRChange, rInput]);

  const handleReset = useCallback(async () => {
    try {
      await api.kalmanReset();
      setPositionData(null);
      setConverged(false);
      setQValue(0.01);
      setRValue(1.0);
      setQInput('0.01');
      setRInput('1');
      setStatusMsg('Kalman filter reset.');
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
        Trilateration + Adaptive Kalman smoothing
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
                Kalman Effect (|raw − smooth|)
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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Kalman Parameters</Text>

        <View style={styles.sliderSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>Q (process noise):</Text>
            <Text style={styles.sliderValue}>{qValue}</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.numberInput}
              value={qInput}
              onChangeText={setQInput}
              keyboardType="numeric"
              placeholder="Enter Q value"
              placeholderTextColor="#6e7681"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={applyQInput}
            />
            <TouchableOpacity style={styles.applyButton} onPress={applyQInput}>
              <Text style={styles.applyButtonText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sliderSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>R (measurement noise):</Text>
            <Text style={styles.sliderValue}>{rValue}</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.numberInput}
              value={rInput}
              onChangeText={setRInput}
              keyboardType="numeric"
              placeholder="Enter R value"
              placeholderTextColor="#6e7681"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={applyRInput}
            />
            <TouchableOpacity style={styles.applyButton} onPress={applyRInput}>
              <Text style={styles.applyButtonText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.buttonDanger} onPress={handleReset}>
          <Text style={styles.buttonText}>Reset Kalman Filter</Text>
        </TouchableOpacity>
      </View>

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
  sliderSection: {
    marginBottom: 16,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sliderLabel: {
    fontSize: 14,
    color: '#c9d1d9',
  },
  sliderValue: {
    fontSize: 14,
    color: '#58a6ff',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  numberInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#e6edf3',
    backgroundColor: '#0d1117',
    fontFamily: 'monospace',
  },
  applyButton: {
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#1f6feb',
    justifyContent: 'center',
  },
  applyButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
