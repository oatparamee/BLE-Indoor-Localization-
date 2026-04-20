/**
 * ==========================================================================
 *   Tab 3 — Position Screen
 * ==========================================================================
 *   Shows raw vs smooth position, Kalman effect, Q/R manual inputs, reset.
 *
 *   Beacon selection:
 *     You can pick ANY 3 BLE beacons detected by the scanner and assign
 *     each one to slot 1 / slot 2 / slot 3 by its UUID (device.id), then
 *     enter that beacon's real (x, y) position in meters. Trilateration
 *     uses those three beacons regardless of their advertised name.
 *
 *   Default beacon config:      frontend/src/config/beacons.ts
 *   Persisted selection store:  frontend/src/config/beaconSelection.ts
 *   Backend position endpoint:  POST /position  (accepts the new payload)
 * ==========================================================================
 */

import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import {bleScanner, BeaconReading} from '../services/bleScanner';
import {api, PositionBeaconInput} from '../services/api';
import {
  BeaconSelection,
  BeaconSlot,
  SLOT_COUNT,
  getBeaconSelection,
  loadBeaconSelection,
  saveBeaconSelection,
} from '../config/beaconSelection';

interface PositionData {
  distances: Record<string, number>;
  raw_position: {x: number; y: number};
  smooth_position: {x: number; y: number};
  converged: boolean;
}

const SLOT_LABELS = ['1st Beacon', '2nd Beacon', '3rd Beacon'];

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

  const [selection, setSelection] = useState<BeaconSelection>(() =>
    getBeaconSelection(),
  );
  const [detected, setDetected] = useState<BeaconReading[]>([]);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);

  const trackingRef = useRef(false);
  const readingsRef = useRef<Record<string, BeaconReading>>({});
  const selectionRef = useRef<BeaconSelection>(selection);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    loadKalmanStatus();
    loadBeaconSelection().then(loaded => {
      setSelection(loaded);
      selectionRef.current = loaded;
    });

    // Subscribe to the shared scanner for the whole lifetime of this
    // screen. Using subscribe() (not startScanning) means other screens
    // like Calibration keep receiving updates too.
    const unsub = bleScanner.subscribe((newReadings, nearby) => {
      readingsRef.current = newReadings;
      setDetected(nearby);
    });

    return () => {
      if (positionIntervalRef.current) {
        clearInterval(positionIntervalRef.current);
        positionIntervalRef.current = null;
      }
      unsub();
      trackingRef.current = false;
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
    const filled = selectionRef.current.filter(
      (s): s is BeaconSlot => s !== null,
    );
    if (filled.length < 3) {
      setError(
        'Pick 3 beacons (1st, 2nd, 3rd) from the detected list and set their (x, y) positions before tracking.',
      );
      return;
    }

    setTracking(true);
    trackingRef.current = true;
    setError('');
    setStatusMsg('Tracking...');

    if (positionIntervalRef.current) {
      clearInterval(positionIntervalRef.current);
    }
    positionIntervalRef.current = setInterval(async () => {
      const readings = readingsRef.current;
      const selNow = selectionRef.current;
      const beaconsPayload: PositionBeaconInput[] = [];
      const missing: string[] = [];

      for (let i = 0; i < SLOT_COUNT; i++) {
        const slot = selNow[i];
        if (!slot) {
          missing.push(SLOT_LABELS[i]);
          continue;
        }
        const reading = readings[slot.id];
        if (!reading || !reading.active || reading.smoothedRssi === null) {
          missing.push(`${SLOT_LABELS[i]} (${slot.name})`);
          continue;
        }
        beaconsPayload.push({
          id: slot.id,
          name: slot.name,
          x: slot.x,
          y: slot.y,
          rssi: reading.smoothedRssi,
        });
      }

      if (beaconsPayload.length < 3) {
        setStatusMsg(`Waiting for: ${missing.join(', ')}`);
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
    trackingRef.current = false;
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
    } catch {
      // Ignore
    }
  }, []);

  const handleRChange = useCallback(async (value: number) => {
    setRValue(value);
    setRInput(String(value));
    try {
      await api.kalmanUpdate({R: value});
    } catch {
      // Ignore
    }
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

  const updateSlot = useCallback(
    (index: number, patch: Partial<BeaconSlot> | null) => {
      setSelection(prev => {
        const next = prev.slice() as BeaconSelection;
        if (patch === null) {
          next[index] = null;
        } else {
          const base = prev[index] ?? {id: '', name: '', x: 0, y: 0};
          next[index] = {...base, ...patch};
        }
        selectionRef.current = next;
        saveBeaconSelection(next).catch(() => {});
        return next;
      });
    },
    [],
  );

  const assignDetectedToSlot = useCallback(
    (index: number, device: BeaconReading) => {
      updateSlot(index, {id: device.id, name: device.name});
      setPickerSlotIndex(null);
    },
    [updateSlot],
  );

  const rawPos = positionData?.raw_position;
  const smoothPos = positionData?.smooth_position;

  let diffX: number | null = null;
  let diffY: number | null = null;
  if (rawPos && smoothPos) {
    diffX = Math.abs(rawPos.x - smoothPos.x);
    diffY = Math.abs(rawPos.y - smoothPos.y);
  }

  const renderSlot = (slot: BeaconSlot | null, index: number) => {
    const assignedId = slot?.id;
    const reading = assignedId ? readingsRef.current[assignedId] : undefined;
    const live =
      reading && reading.active && reading.smoothedRssi !== null
        ? `${reading.smoothedRssi.toFixed(1)} dBm`
        : '—';

    return (
      <View key={index} style={styles.slotCard}>
        <View style={styles.slotHeader}>
          <Text style={styles.slotTitle}>{SLOT_LABELS[index]}</Text>
          {slot ? (
            <TouchableOpacity onPress={() => updateSlot(index, null)}>
              <Text style={styles.slotClear}>clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => setPickerSlotIndex(index)}>
          <Text style={styles.pickerButtonText} numberOfLines={1}>
            {slot
              ? `${slot.name}  ·  ${slot.id.substring(0, 17)}`
              : 'Tap to choose a detected beacon…'}
          </Text>
          <Text style={styles.pickerButtonChevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.coordRow}>
          <View style={styles.coordField}>
            <Text style={styles.coordLabel}>x (m)</Text>
            <TextInput
              style={styles.coordInput}
              value={slot ? String(slot.x) : ''}
              onChangeText={text => {
                const n = Number(text);
                updateSlot(index, {
                  x: Number.isFinite(n) ? n : 0,
                });
              }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={styles.coordField}>
            <Text style={styles.coordLabel}>y (m)</Text>
            <TextInput
              style={styles.coordInput}
              value={slot ? String(slot.y) : ''}
              onChangeText={text => {
                const n = Number(text);
                updateSlot(index, {
                  y: Number.isFinite(n) ? n : 0,
                });
              }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#6e7681"
            />
          </View>
          <View style={styles.coordField}>
            <Text style={styles.coordLabel}>RSSI</Text>
            <Text style={styles.coordLive}>{live}</Text>
          </View>
        </View>
      </View>
    );
  };

  const selectedIds = selection
    .filter((s): s is BeaconSlot => s !== null)
    .map(s => s.id);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Position</Text>
      <Text style={styles.subtitle}>
        Trilateration + Adaptive Kalman smoothing
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Beacon Selection</Text>
        <Text style={styles.cardHint}>
          Pick any 3 detected BLE beacons and assign them as 1st / 2nd / 3rd.
          The scanner picks them up by UUID — the advertised name doesn't
          need to match Beacon_A / B / C anymore.
        </Text>
        {selection.map((slot, i) => renderSlot(slot, i))}
      </View>

      <TouchableOpacity
        style={[styles.button, tracking ? styles.buttonStop : styles.buttonStart]}
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
              <Text style={styles.cardTitle}>Kalman Effect (|raw − smooth|)</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Δx:</Text>
                <Text style={styles.rowValueHighlight}>{diffX.toFixed(4)} m</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Δy:</Text>
                <Text style={styles.rowValueHighlight}>{diffY.toFixed(4)} m</Text>
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

      <Modal
        visible={pickerSlotIndex !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerSlotIndex(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerSlotIndex !== null
                  ? `Choose ${SLOT_LABELS[pickerSlotIndex]}`
                  : ''}
              </Text>
              <TouchableOpacity onPress={() => setPickerSlotIndex(null)}>
                <Text style={styles.modalClose}>close</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>
              Showing all BLE devices the scanner sees. Tap one to assign it.
            </Text>
            <ScrollView style={styles.modalList}>
              {detected.length === 0 ? (
                <Text style={styles.modalEmpty}>
                  No devices detected yet. Make sure Bluetooth is on and the
                  beacons are broadcasting.
                </Text>
              ) : (
                detected.map(dev => {
                  const alreadyTaken =
                    selectedIds.includes(dev.id) &&
                    selection[pickerSlotIndex ?? -1]?.id !== dev.id;
                  return (
                    <TouchableOpacity
                      key={dev.id}
                      style={[
                        styles.modalRow,
                        alreadyTaken && styles.modalRowTaken,
                      ]}
                      disabled={alreadyTaken}
                      onPress={() => {
                        if (pickerSlotIndex !== null) {
                          assignDetectedToSlot(pickerSlotIndex, dev);
                        }
                      }}>
                      <View style={{flex: 1}}>
                        <Text style={styles.modalRowName}>{dev.name}</Text>
                        <Text style={styles.modalRowId}>{dev.id}</Text>
                      </View>
                      <Text style={styles.modalRowRssi}>
                        {dev.rawRssi ?? '?'} dBm
                      </Text>
                      {alreadyTaken ? (
                        <Text style={styles.modalRowBadge}>IN USE</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  buttonStart: {
    backgroundColor: '#238636',
  },
  buttonStop: {
    backgroundColor: '#da3633',
  },
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
  cardHint: {
    fontSize: 13,
    color: '#8b949e',
    marginBottom: 12,
    lineHeight: 18,
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
  slotCard: {
    backgroundColor: '#0d1117',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 10,
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  slotTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#d2a8ff',
  },
  slotClear: {
    color: '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pickerButtonText: {
    flex: 1,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  pickerButtonChevron: {
    color: '#8b949e',
    fontSize: 18,
    marginLeft: 8,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 8,
  },
  coordField: {
    flex: 1,
  },
  coordLabel: {
    color: '#8b949e',
    fontSize: 12,
    marginBottom: 4,
  },
  coordInput: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  coordLive: {
    color: '#58a6ff',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: '#161b22',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '700',
  },
  modalClose: {
    color: '#58a6ff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalHint: {
    color: '#8b949e',
    fontSize: 12,
    marginBottom: 12,
  },
  modalList: {
    maxHeight: 400,
  },
  modalEmpty: {
    color: '#6e7681',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 24,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    gap: 8,
  },
  modalRowTaken: {
    opacity: 0.4,
  },
  modalRowName: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '600',
  },
  modalRowId: {
    color: '#6e7681',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  modalRowRssi: {
    color: '#8b949e',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  modalRowBadge: {
    backgroundColor: '#3d1117',
    color: '#f85149',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
