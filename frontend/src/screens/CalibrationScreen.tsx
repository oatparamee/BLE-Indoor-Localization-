/**
 * ==========================================================================
 *   Tab 1 — Calibration Screen
 * ==========================================================================
 *   Beacon config is defined in: frontend/src/config/beacons.ts
 *   Backend config is at:        backend/config.py
 * ==========================================================================
 */

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
import {api} from '../services/api';

interface AnalysisResult {
  sample_count: number;
  mean_rssi: number;
  variance: number;
  std_deviation: number;
  noise_level: string;
  suggested_Q: number;
  suggested_R: number;
}

export default function CalibrationScreen() {
  const [knownDistance, setKnownDistance] = useState('1.0');
  const [collecting, setCollecting] = useState(false);
  const [samplesCollected, setSamplesCollected] = useState(0);
  const [sampleCountInput, setSampleCountInput] = useState('30');
  const [maxSamples, setMaxSamples] = useState(30);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [kalmanInitialized, setKalmanInitialized] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  /** Selected beacon is identified by its BLE UUID (device.id). */
  const [selectedBeaconId, setSelectedBeaconId] = useState<string>('');
  const [detectedBeacons, setDetectedBeacons] = useState<BeaconReading[]>([]);

  // Path-loss-exponent (N) calculator inputs.
  // Formula:  N = ( RSSI(d0) - RSSI(d1) )  /  ( 10 * log10(d1 / d0) )
  const [nD0, setND0] = useState('1.0');
  const [nRssi0, setNRssi0] = useState('');
  const [nD1, setND1] = useState('2.0');
  const [nRssi1, setNRssi1] = useState('');
  const [nResult, setNResult] = useState<number | null>(null);
  const [nError, setNError] = useState('');

  const collectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beaconReadingsRef = useRef<Record<string, BeaconReading>>({});
  const selectedIdRef = useRef<string>('');

  useEffect(() => {
    selectedIdRef.current = selectedBeaconId;
  }, [selectedBeaconId]);

  const startCollecting = useCallback(async () => {
    const dist = parseFloat(knownDistance);
    if (isNaN(dist) || dist <= 0) {
      Alert.alert('Invalid Distance', 'Enter a positive distance in meters.');
      return;
    }

    const parsedCount = parseInt(sampleCountInput, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      Alert.alert(
        'Invalid Sample Count',
        'Enter a positive integer for the number of samples to collect.',
      );
      return;
    }

    if (!selectedIdRef.current) {
      Alert.alert(
        'No Beacon Selected',
        'Tap one of the detected beacons above so the app knows which one to sample.',
      );
      return;
    }

    setMaxSamples(parsedCount);
    setCollecting(true);
    setSamplesCollected(0);
    setAnalysis(null);
    setKalmanInitialized(false);
    setStatusMessage('Resetting backend calibration buffer...');

    try {
      await api.calibrateReset(parsedCount);
    } catch (err: any) {
      // Surface reset errors — a stalled reset means the backend is unreachable
      // and every sample will fail silently otherwise.
      setStatusMessage(
        `Warning: could not reset backend (${err?.message || 'unknown'}). Continuing...`,
      );
    }

    setStatusMessage('Waiting for first RSSI reading...');

    let count = 0;
    let inFlight = false;

    const tick = async () => {
      // Prevent overlapping requests if one backend call takes > 1s.
      if (inFlight) return;

      // Read directly from the scanner so we don't depend on the other
      // subscribe callback having fired yet (fixes the "stuck at 0" case
      // where the ref hadn't been populated before Start was pressed).
      const liveReadings = bleScanner.getReadings();
      const id = selectedIdRef.current;

      if (!id) {
        setStatusMessage('No beacon selected. Tap one in the list above.');
        return;
      }

      const beacon = liveReadings[id] ?? beaconReadingsRef.current[id];
      const label = beacon?.name || id;

      if (!beacon) {
        setStatusMessage(
          `Waiting for beacon ${label} to be detected by the scanner...`,
        );
        return;
      }

      if (beacon.rawRssi === null || beacon.rawRssi === undefined) {
        setStatusMessage(`Waiting for first RSSI from ${label}...`);
        return;
      }

      if (!beacon.active) {
        setStatusMessage(
          `${label} currently marked LOST — holding on sending samples.`,
        );
        return;
      }

      inFlight = true;
      try {
        const result = await api.calibrateSample(beacon.rawRssi, dist);

        if (result && typeof result === 'object' && 'error' in result) {
          setStatusMessage(`Backend error: ${(result as any).error}`);
          return;
        }

        if (typeof result?.collected !== 'number') {
          setStatusMessage(
            `Unexpected backend response: ${JSON.stringify(result)}`,
          );
          return;
        }

        count = result.collected;
        setSamplesCollected(count);
        setStatusMessage(
          `Sample ${count}/${parsedCount} — RSSI: ${beacon.rawRssi} dBm (${label})`,
        );

        if (result.ready || count >= parsedCount) {
          if (collectIntervalRef.current) {
            clearInterval(collectIntervalRef.current);
            collectIntervalRef.current = null;
          }
          setCollecting(false);
          setStatusMessage('Collection complete. Analyzing...');

          const analysisResult = await api.calibrateAnalyze();
          if (analysisResult && (analysisResult as any).error) {
            setStatusMessage(
              `Analyze failed: ${(analysisResult as any).error}`,
            );
          } else {
            setAnalysis(analysisResult);
            setStatusMessage('Analysis complete. Review values and apply.');
          }
        }
      } catch (err: any) {
        setStatusMessage(
          `Network error: ${err?.message || err} — check backend URL in Settings.`,
        );
      } finally {
        inFlight = false;
      }
    };

    // Run the first tick immediately so users see progress within the first
    // second instead of waiting a full interval.
    tick();
    collectIntervalRef.current = setInterval(tick, 1000);
  }, [knownDistance, sampleCountInput]);

  // Always scan for nearby devices while this screen is mounted so the
  // user can see and pick any BLE beacon (not just the hard-coded names).
  //
  // Uses the multi-subscriber API so Position / LiveReadings screens can
  // also receive updates concurrently. The unsub handle is called on
  // unmount so the scanner only stops when the LAST screen leaves.
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

  const stopCollecting = useCallback(() => {
    if (collectIntervalRef.current) {
      clearInterval(collectIntervalRef.current);
      collectIntervalRef.current = null;
    }
    setCollecting(false);
    setStatusMessage('Collection stopped.');
  }, []);

  const applyKalman = useCallback(async () => {
    if (!analysis) {
      return;
    }
    try {
      const result = await api.kalmanInitialize(
        analysis.suggested_Q,
        analysis.suggested_R,
      );
      setKalmanInitialized(true);
      setStatusMessage(
        `Kalman initialized — Q: ${result.Q}, R: ${result.R}`,
      );
    } catch (err: any) {
      setStatusMessage(`Error initializing Kalman: ${err.message}`);
    }
  }, [analysis]);

  const calculateN = useCallback(() => {
    const d0 = parseFloat(nD0);
    const d1 = parseFloat(nD1);
    const rssi0 = parseFloat(nRssi0);
    const rssi1 = parseFloat(nRssi1);

    if (!Number.isFinite(d0) || d0 <= 0) {
      setNError('d0 must be a positive number (meters).');
      setNResult(null);
      return;
    }
    if (!Number.isFinite(d1) || d1 <= 0) {
      setNError('d1 must be a positive number (meters).');
      setNResult(null);
      return;
    }
    if (d0 === d1) {
      setNError('d0 and d1 must be different distances.');
      setNResult(null);
      return;
    }
    if (!Number.isFinite(rssi0) || !Number.isFinite(rssi1)) {
      setNError('RSSI(d0) and RSSI(d1) must both be numbers (dBm).');
      setNResult(null);
      return;
    }

    const denominator = 10 * Math.log10(d1 / d0);
    if (denominator === 0) {
      setNError('Cannot divide by zero (log10(d1/d0) is 0).');
      setNResult(null);
      return;
    }

    const n = (rssi0 - rssi1) / denominator;
    setNError('');
    setNResult(n);
  }, [nD0, nD1, nRssi0, nRssi1]);

  const useMeanAs = useCallback(
    (target: 'd0' | 'd1') => {
      if (!analysis) return;
      const mean = String(analysis.mean_rssi);
      if (target === 'd0') {
        setNRssi0(mean);
        setND0(knownDistance);
      } else {
        setNRssi1(mean);
        setND1(knownDistance);
      }
    },
    [analysis, knownDistance],
  );

  const progressPercent = maxSamples > 0 ? (samplesCollected / maxSamples) * 100 : 0;

  const noiseLevelColor = (level: string) => {
    if (level === 'low') return '#4CAF50';
    if (level === 'medium') return '#FF9800';
    return '#F44336';
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Calibration</Text>
      <Text style={styles.subtitle}>
        Stand at a known distance from a beacon and collect RSSI samples
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>
          Select Beacon (detected via BLE, any UUID works):
        </Text>
        {detectedBeacons.length === 0 ? (
          <Text style={styles.hintText}>
            Scanning for beacons... make sure Bluetooth is on.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.beaconSelector}>
            {detectedBeacons.map(dev => {
              const isSel = selectedBeaconId === dev.id;
              return (
                <TouchableOpacity
                  key={dev.id}
                  style={[
                    styles.beaconButton,
                    isSel && styles.beaconButtonActive,
                  ]}
                  onPress={() => setSelectedBeaconId(dev.id)}>
                  <Text
                    style={[
                      styles.beaconButtonText,
                      isSel && styles.beaconButtonTextActive,
                    ]}>
                    {dev.name}
                  </Text>
                  <Text
                    style={[
                      styles.beaconButtonSub,
                      isSel && styles.beaconButtonSubActive,
                    ]}>
                    {dev.id.substring(0, 12)}{'  '}
                    {dev.rawRssi !== null ? `${dev.rawRssi} dBm` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.inlineRow}>
          <View style={styles.inlineField}>
            <Text style={styles.label}>Known Distance (meters):</Text>
            <TextInput
              style={styles.input}
              value={knownDistance}
              onChangeText={setKnownDistance}
              keyboardType="decimal-pad"
              editable={!collecting}
              placeholder="e.g. 1.0"
              placeholderTextColor="#999"
            />
          </View>
          <View style={styles.inlineField}>
            <Text style={styles.label}>Number of Samples:</Text>
            <TextInput
              style={styles.input}
              value={sampleCountInput}
              onChangeText={setSampleCountInput}
              keyboardType="number-pad"
              editable={!collecting}
              placeholder="e.g. 30"
              placeholderTextColor="#999"
            />
          </View>
        </View>
        <Text style={styles.hintText}>
          The app will collect this many RSSI readings and the backend will
          return the average.
        </Text>
      </View>

      <View style={styles.section}>
        {!collecting ? (
          <TouchableOpacity style={styles.buttonPrimary} onPress={startCollecting}>
            <Text style={styles.buttonText}>Start Collecting Samples</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.buttonDanger} onPress={stopCollecting}>
            <Text style={styles.buttonText}>Stop Collection</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          Progress: {samplesCollected} / {maxSamples}
        </Text>
        <View style={styles.progressBarBg}>
          <View
            style={[styles.progressBarFill, {width: `${progressPercent}%`}]}
          />
        </View>
      </View>

      {statusMessage ? (
        <View style={styles.section}>
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      ) : null}

      {analysis ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Analysis Results</Text>

          <View style={styles.averageBox}>
            <Text style={styles.averageLabel}>
              Average RSSI over {analysis.sample_count} samples @{' '}
              {knownDistance} m
            </Text>
            <Text style={styles.averageValue}>
              {analysis.mean_rssi.toFixed(2)} dBm
            </Text>
            <View style={styles.averageButtons}>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => useMeanAs('d0')}>
                <Text style={styles.smallButtonText}>
                  Use as RSSI(d0)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => useMeanAs('d1')}>
                <Text style={styles.smallButtonText}>
                  Use as RSSI(d1)
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Samples:</Text>
            <Text style={styles.resultValue}>{analysis.sample_count}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Mean RSSI:</Text>
            <Text style={styles.resultValue}>{analysis.mean_rssi} dBm</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Variance:</Text>
            <Text style={styles.resultValue}>{analysis.variance}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Std Deviation:</Text>
            <Text style={styles.resultValue}>{analysis.std_deviation}</Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Noise Level:</Text>
            <Text
              style={[
                styles.resultValue,
                {color: noiseLevelColor(analysis.noise_level)},
              ]}>
              {analysis.noise_level.toUpperCase()}
            </Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Suggested Kalman Values</Text>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Q (process noise):</Text>
            <Text style={styles.resultValueHighlight}>
              {analysis.suggested_Q.toFixed(6)}
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>R (measurement noise):</Text>
            <Text style={styles.resultValueHighlight}>
              {analysis.suggested_R.toFixed(6)}
            </Text>
          </View>

          <TouchableOpacity style={styles.buttonSuccess} onPress={applyKalman}>
            <Text style={styles.buttonText}>Apply to Kalman Filter</Text>
          </TouchableOpacity>

          {kalmanInitialized ? (
            <View style={styles.confirmationBox}>
              <Text style={styles.confirmationText}>
                Kalman Filter initialized successfully with calibrated values.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Path Loss Exponent (N) Calculator</Text>
        <Text style={styles.nFormula}>
          N = ( RSSI(d0) − RSSI(d1) ) / ( 10 · log₁₀(d1 / d0) )
        </Text>
        <Text style={styles.nHint}>
          Collect samples at two different distances, use the averages as
          RSSI(d0) and RSSI(d1), and compute N. All four values can also be
          typed in by hand.
        </Text>

        <View style={styles.nRow}>
          <View style={styles.nField}>
            <Text style={styles.nLabel}>d0 (m)</Text>
            <TextInput
              style={styles.input}
              value={nD0}
              onChangeText={setND0}
              keyboardType="numeric"
              placeholder="1.0"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={styles.nField}>
            <Text style={styles.nLabel}>RSSI(d0) (dBm)</Text>
            <TextInput
              style={styles.input}
              value={nRssi0}
              onChangeText={setNRssi0}
              keyboardType="numeric"
              placeholder="-63"
              placeholderTextColor="#6e7681"
            />
          </View>
        </View>

        <View style={styles.nRow}>
          <View style={styles.nField}>
            <Text style={styles.nLabel}>d1 (m)</Text>
            <TextInput
              style={styles.input}
              value={nD1}
              onChangeText={setND1}
              keyboardType="numeric"
              placeholder="2.0"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={styles.nField}>
            <Text style={styles.nLabel}>RSSI(d1) (dBm)</Text>
            <TextInput
              style={styles.input}
              value={nRssi1}
              onChangeText={setNRssi1}
              keyboardType="numeric"
              placeholder="-75"
              placeholderTextColor="#6e7681"
            />
          </View>
        </View>

        <TouchableOpacity style={styles.buttonPrimary} onPress={calculateN}>
          <Text style={styles.buttonText}>Calculate N</Text>
        </TouchableOpacity>

        {nError ? <Text style={styles.errorText}>{nError}</Text> : null}

        {nResult !== null && !nError ? (
          <View style={styles.nResultBox}>
            <Text style={styles.nResultLabel}>Calculated N:</Text>
            <Text style={styles.nResultValue}>{nResult.toFixed(4)}</Text>
            <Text style={styles.nResultHint}>
              Typical indoor range is roughly 1.6 – 4.0. Copy this into{' '}
              frontend/src/config/beacons.ts and backend/config.py to make
              it the new path loss exponent.
            </Text>
          </View>
        ) : null}
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
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 12,
  },
  label: {
    fontSize: 15,
    color: '#c9d1d9',
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
  inlineRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  inlineField: {
    flex: 1,
  },
  beaconSelector: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  beaconButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    minWidth: 120,
  },
  beaconButtonActive: {
    backgroundColor: '#1f6feb',
    borderColor: '#1f6feb',
  },
  beaconButtonText: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  beaconButtonTextActive: {
    color: '#ffffff',
  },
  beaconButtonSub: {
    color: '#6e7681',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  beaconButtonSubActive: {
    color: '#c9d1d9',
  },
  hintText: {
    color: '#6e7681',
    fontSize: 13,
    fontStyle: 'italic',
  },
  buttonPrimary: {
    backgroundColor: '#1f6feb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDanger: {
    backgroundColor: '#da3633',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSuccess: {
    backgroundColor: '#238636',
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
  progressBarBg: {
    height: 12,
    backgroundColor: '#21262d',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1f6feb',
    borderRadius: 6,
  },
  statusText: {
    fontSize: 14,
    color: '#8b949e',
    fontStyle: 'italic',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  resultLabel: {
    fontSize: 15,
    color: '#8b949e',
  },
  resultValue: {
    fontSize: 15,
    color: '#e6edf3',
    fontWeight: '500',
  },
  resultValueHighlight: {
    fontSize: 15,
    color: '#58a6ff',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: '#30363d',
    marginVertical: 16,
  },
  confirmationBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#0d2818',
    borderWidth: 1,
    borderColor: '#238636',
    borderRadius: 8,
  },
  confirmationText: {
    color: '#3fb950',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  averageBox: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  averageLabel: {
    color: '#8b949e',
    fontSize: 13,
    marginBottom: 4,
    textAlign: 'center',
  },
  averageValue: {
    color: '#58a6ff',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  averageButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  smallButton: {
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  smallButtonText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
  nFormula: {
    color: '#d2a8ff',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  nHint: {
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  nRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  nField: {
    flex: 1,
  },
  nLabel: {
    color: '#8b949e',
    fontSize: 12,
    marginBottom: 4,
  },
  errorText: {
    color: '#f85149',
    fontSize: 13,
    marginTop: 10,
  },
  nResultBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#0d2818',
    borderWidth: 1,
    borderColor: '#238636',
    borderRadius: 10,
    alignItems: 'center',
  },
  nResultLabel: {
    color: '#8b949e',
    fontSize: 13,
    marginBottom: 4,
  },
  nResultValue: {
    color: '#3fb950',
    fontSize: 34,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  nResultHint: {
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
