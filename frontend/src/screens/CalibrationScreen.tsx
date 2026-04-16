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
  const [maxSamples] = useState(30);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [kalmanInitialized, setKalmanInitialized] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  /** Selected beacon is identified by its BLE UUID (device.id). */
  const [selectedBeaconId, setSelectedBeaconId] = useState<string>('');
  const [detectedBeacons, setDetectedBeacons] = useState<BeaconReading[]>([]);

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
    if (!selectedIdRef.current) {
      Alert.alert(
        'No Beacon Selected',
        'Wait for a beacon to appear in the list and tap it first.',
      );
      return;
    }

    setCollecting(true);
    setSamplesCollected(0);
    setAnalysis(null);
    setKalmanInitialized(false);
    setStatusMessage('Starting BLE scan for calibration...');

    try {
      await api.calibrateReset();
    } catch {
      // Ignore reset errors
    }

    bleScanner.startScanning((readings, nearby) => {
      beaconReadingsRef.current = readings;
      setDetectedBeacons(nearby);
    });

    let count = 0;
    collectIntervalRef.current = setInterval(async () => {
      const readings = beaconReadingsRef.current;
      const id = selectedIdRef.current;
      const beacon = readings[id];
      const label = beacon?.name || id;

      if (!beacon || beacon.rawRssi === null) {
        setStatusMessage(`Waiting for ${label}...`);
        return;
      }

      try {
        const result = await api.calibrateSample(beacon.rawRssi, dist);
        count = result.collected;
        setSamplesCollected(count);
        setStatusMessage(`Sample ${count}/${maxSamples} — RSSI: ${beacon.rawRssi}`);

        if (result.ready || count >= maxSamples) {
          if (collectIntervalRef.current) {
            clearInterval(collectIntervalRef.current);
            collectIntervalRef.current = null;
          }
          bleScanner.stopScanning();
          setCollecting(false);
          setStatusMessage('Collection complete. Analyzing...');

          const analysisResult = await api.calibrateAnalyze();
          setAnalysis(analysisResult);
          setStatusMessage('Analysis complete. Review values and apply.');
        }
      } catch (err: any) {
        setStatusMessage(`Error: ${err.message}`);
      }
    }, 1000);
  }, [knownDistance, maxSamples]);

  // Always scan for nearby devices while this screen is mounted so the
  // user can see and pick any BLE beacon (not just the hard-coded names).
  useEffect(() => {
    bleScanner
      .startScanning((readings, nearby) => {
        beaconReadingsRef.current = readings;
        setDetectedBeacons(nearby);
        if (!selectedIdRef.current && nearby.length > 0) {
          const first = nearby[0];
          selectedIdRef.current = first.id;
          setSelectedBeaconId(first.id);
        }
      })
      .catch(() => {});
    return () => {
      if (collectIntervalRef.current) {
        clearInterval(collectIntervalRef.current);
        collectIntervalRef.current = null;
      }
      bleScanner.stopScanning();
    };
  }, []);

  const stopCollecting = useCallback(() => {
    if (collectIntervalRef.current) {
      clearInterval(collectIntervalRef.current);
      collectIntervalRef.current = null;
    }
    bleScanner.stopScanning();
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
});
