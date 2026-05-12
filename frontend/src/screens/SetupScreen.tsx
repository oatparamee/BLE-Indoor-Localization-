import React, {useState, useEffect, useRef} from 'react';
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
import {
  SavedBeacon,
  loadBeaconConfig,
  saveBeacon,
  deleteBeacon,
  getBeaconConfig,
} from '../config/beaconConfig';

export default function SetupScreen() {
  const [scanning, setScanning] = useState(false);
  const [detected, setDetected] = useState<BeaconReading[]>([]);
  const [config, setConfig] = useState<Record<string, SavedBeacon>>({});
  const [editTarget, setEditTarget] = useState<{
    id: string;
    advertisedName: string;
  } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [xInput, setXInput] = useState('');
  const [yInput, setYInput] = useState('');
  const [qInput, setQInput] = useState('');
  const [rInput, setRInput] = useState('');
  const [saveError, setSaveError] = useState('');

  const unsubRef = useRef<(() => void) | null>(null);
  const readingsRef = useRef<Record<string, BeaconReading>>({});

  useEffect(() => {
    loadBeaconConfig().then(setConfig);
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const toggleScanning = () => {
    if (scanning) {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      setScanning(false);
    } else {
      setScanning(true);
      unsubRef.current = bleScanner.subscribe((readings, nearby) => {
        readingsRef.current = readings;
        setDetected(nearby);
      });
    }
  };

  const openModal = (id: string, advertisedName: string) => {
    const existing = getBeaconConfig()[id];
    setEditTarget({id, advertisedName});
    setNameInput(existing?.name ?? advertisedName);
    setXInput(existing ? String(existing.x) : '');
    setYInput(existing ? String(existing.y) : '');
    setQInput(
      existing && typeof existing.q === 'number' ? String(existing.q) : '',
    );
    setRInput(
      existing && typeof existing.r === 'number' ? String(existing.r) : '',
    );
    setSaveError('');
  };

  const handleSave = async () => {
    if (!editTarget) return;
    const x = parseFloat(xInput);
    const y = parseFloat(yInput);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setSaveError('Enter valid numbers for x and y.');
      return;
    }

    // Q/R are optional. If either is provided, BOTH must be valid positives
    // (a 1D Kalman filter with q<=0 or r<=0 is mathematically degenerate).
    const qRaw = qInput.trim();
    const rRaw = rInput.trim();
    let q: number | undefined;
    let r: number | undefined;
    if (qRaw !== '' || rRaw !== '') {
      const qParsed = parseFloat(qRaw);
      const rParsed = parseFloat(rRaw);
      if (
        !Number.isFinite(qParsed) ||
        !Number.isFinite(rParsed) ||
        qParsed <= 0 ||
        rParsed <= 0
      ) {
        setSaveError('Q and R must both be positive numbers (or leave both blank).');
        return;
      }
      q = qParsed;
      r = rParsed;
    }

    const beacon: SavedBeacon = {
      id: editTarget.id,
      name: nameInput.trim() || editTarget.advertisedName,
      x,
      y,
      ...(q !== undefined ? {q} : {}),
      ...(r !== undefined ? {r} : {}),
    };
    await saveBeacon(beacon);
    setConfig({...getBeaconConfig()});
    setEditTarget(null);
  };

  const handleDelete = async () => {
    if (!editTarget) return;
    await deleteBeacon(editTarget.id);
    setConfig({...getBeaconConfig()});
    setEditTarget(null);
  };

  const configuredIds = new Set(Object.keys(config));
  const configuredList = Object.values(config);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Beacon Setup</Text>
      <Text style={styles.subtitle}>
        Configure each beacon's position once — the app remembers it across sessions.
      </Text>

      {configuredList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Configured ({configuredList.length})
          </Text>
          {configuredList.map(beacon => {
            const reading = readingsRef.current[beacon.id];
            const rssi = reading?.smoothedRssi;
            const active = reading?.active;
            return (
              <TouchableOpacity
                key={beacon.id}
                style={styles.beaconCard}
                onPress={() => openModal(beacon.id, beacon.name)}>
                <View style={styles.beaconCardLeft}>
                  <View style={styles.nameRow}>
                    <Text style={styles.beaconName}>{beacon.name}</Text>
                    {active ? (
                      <View style={styles.activeDot} />
                    ) : null}
                  </View>
                  <Text style={styles.beaconId}>{beacon.id}</Text>
                  <Text style={styles.beaconCoords}>
                    x: {beacon.x} m  ·  y: {beacon.y} m
                  </Text>
                  {typeof beacon.q === 'number' && typeof beacon.r === 'number' ? (
                    <Text style={styles.beaconKalman}>
                      Q: {beacon.q.toFixed(4)}  ·  R: {beacon.r.toFixed(4)}
                    </Text>
                  ) : (
                    <Text style={styles.beaconKalmanMissing}>
                      Q/R: using global default
                    </Text>
                  )}
                </View>
                <View style={styles.beaconCardRight}>
                  {rssi !== null && rssi !== undefined ? (
                    <Text style={styles.rssi}>{rssi.toFixed(1)} dBm</Text>
                  ) : (
                    <Text style={styles.rssiDim}>not detected</Text>
                  )}
                  <Text style={styles.editLabel}>Edit ›</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, scanning ? styles.buttonStop : styles.buttonStart]}
        onPress={toggleScanning}>
        <Text style={styles.buttonText}>
          {scanning ? 'Stop Scanning' : 'Scan for Beacons'}
        </Text>
      </TouchableOpacity>

      {scanning && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detected Beacons</Text>
          {detected.length === 0 ? (
            <Text style={styles.emptyText}>
              Scanning... bring beacons nearby.
            </Text>
          ) : (
            detected.map(dev => {
              const isConfigured = configuredIds.has(dev.id);
              return (
                <TouchableOpacity
                  key={dev.id}
                  style={[
                    styles.beaconCard,
                    isConfigured && styles.beaconCardConfigured,
                  ]}
                  onPress={() => openModal(dev.id, dev.name)}>
                  <View style={styles.beaconCardLeft}>
                    <Text style={styles.beaconName}>{dev.name}</Text>
                    <Text style={styles.beaconId}>{dev.id}</Text>
                  </View>
                  <View style={styles.beaconCardRight}>
                    <Text style={styles.rssi}>{dev.rawRssi ?? '?'} dBm</Text>
                    <Text
                      style={
                        isConfigured ? styles.configuredLabel : styles.tapLabel
                      }>
                      {isConfigured ? 'CONFIGURED ›' : 'Tap to set up ›'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}

      <View style={{height: 40}} />

      <Modal
        visible={editTarget !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editTarget && configuredIds.has(editTarget.id)
                  ? 'Edit Beacon'
                  : 'Set Up Beacon'}
              </Text>
              <TouchableOpacity onPress={() => setEditTarget(null)}>
                <Text style={styles.modalClose}>cancel</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalId}>{editTarget?.id}</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="e.g. BCPro_0"
              placeholderTextColor="#6e7681"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.coordsRow}>
              <View style={{flex: 1}}>
                <Text style={styles.fieldLabel}>x (meters)</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={xInput}
                  onChangeText={setXInput}
                  keyboardType="numeric"
                  placeholder="0.0"
                  placeholderTextColor="#6e7681"
                />
              </View>
              <View style={{width: 12}} />
              <View style={{flex: 1}}>
                <Text style={styles.fieldLabel}>y (meters)</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={yInput}
                  onChangeText={setYInput}
                  keyboardType="numeric"
                  placeholder="0.0"
                  placeholderTextColor="#6e7681"
                />
              </View>
            </View>

            <Text style={styles.kalmanHint}>
              1D Kalman noise (optional — auto-filled by RSSI Profile screen).
              Leave both blank to use the global default.
            </Text>
            <View style={styles.coordsRow}>
              <View style={{flex: 1}}>
                <Text style={styles.fieldLabel}>Q (process noise)</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={qInput}
                  onChangeText={setQInput}
                  keyboardType="numeric"
                  placeholder="e.g. 0.7143"
                  placeholderTextColor="#6e7681"
                />
              </View>
              <View style={{width: 12}} />
              <View style={{flex: 1}}>
                <Text style={styles.fieldLabel}>R (measurement noise)</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={rInput}
                  onChangeText={setRInput}
                  keyboardType="numeric"
                  placeholder="e.g. 1.29"
                  placeholderTextColor="#6e7681"
                />
              </View>
            </View>

            {saveError ? (
              <Text style={styles.saveError}>{saveError}</Text>
            ) : null}

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>

            {editTarget && configuredIds.has(editTarget.id) ? (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDelete}>
                <Text style={styles.deleteButtonText}>Remove Beacon</Text>
              </TouchableOpacity>
            ) : null}
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
    lineHeight: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  beaconCard: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  beaconCardConfigured: {
    borderColor: '#238636',
  },
  beaconCardLeft: {
    flex: 1,
  },
  beaconCardRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  beaconName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e6edf3',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#3fb950',
  },
  beaconId: {
    fontSize: 11,
    color: '#6e7681',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  beaconCoords: {
    fontSize: 12,
    color: '#8b949e',
    fontFamily: 'monospace',
  },
  beaconKalman: {
    fontSize: 11,
    color: '#3fb950',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  beaconKalmanMissing: {
    fontSize: 11,
    color: '#d29922',
    fontStyle: 'italic',
    marginTop: 2,
  },
  kalmanHint: {
    fontSize: 12,
    color: '#8b949e',
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 16,
  },
  rssi: {
    fontSize: 13,
    color: '#58a6ff',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  rssiDim: {
    fontSize: 12,
    color: '#6e7681',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  editLabel: {
    fontSize: 12,
    color: '#58a6ff',
    fontWeight: '600',
  },
  tapLabel: {
    fontSize: 12,
    color: '#8b949e',
  },
  configuredLabel: {
    fontSize: 12,
    color: '#3fb950',
    fontWeight: '600',
  },
  emptyText: {
    color: '#6e7681',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  button: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonStart: {backgroundColor: '#238636'},
  buttonStop: {backgroundColor: '#da3633'},
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
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
    padding: 20,
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
  modalId: {
    color: '#6e7681',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#8b949e',
    fontSize: 13,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontSize: 14,
    marginBottom: 14,
  },
  coordsRow: {
    flexDirection: 'row',
  },
  saveError: {
    color: '#f85149',
    fontSize: 13,
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: '#238636',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  deleteButton: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#da3633',
  },
  deleteButtonText: {
    color: '#f85149',
    fontWeight: '600',
    fontSize: 14,
  },
});
