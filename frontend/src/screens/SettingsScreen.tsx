/**
 * ==========================================================================
 *   Tab 4 — Settings Screen
 * ==========================================================================
 *   Lets the user choose the phone-local positioning engine or the
 *   older Flask backend fallback.
 * ==========================================================================
 */

import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import type {ApiMode} from '../config/api';
import {
  getApiMode,
  getApiUrl,
  loadApiMode,
  loadApiUrl,
  saveApiMode,
  saveApiUrl,
} from '../config/api';
import {api} from '../services/api';

export default function SettingsScreen() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<ApiMode>('local');
  const [saved, setSaved] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'untested' | 'testing' | 'connected' | 'failed'
  >('untested');
  const [serverInfo, setServerInfo] = useState('');

  useEffect(() => {
    Promise.all([loadApiUrl(), loadApiMode()]).then(([loadedUrl, loadedMode]) => {
      setUrl(loadedUrl);
      setMode(loadedMode);
    });
  }, []);

  const handleModeChange = useCallback(async (nextMode: ApiMode) => {
    setMode(nextMode);
    await saveApiMode(nextMode);
    setConnectionStatus('untested');
    setServerInfo('');
  }, []);

  const handleSave = useCallback(async () => {
    let cleaned = url.trim();
    if (cleaned.endsWith('/')) {
      cleaned = cleaned.slice(0, -1);
    }
    if (!cleaned.startsWith('http')) {
      cleaned = `http://${cleaned}`;
    }
    setUrl(cleaned);
    await saveApiUrl(cleaned);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [url]);

  const testConnection = useCallback(async () => {
    setConnectionStatus('testing');
    setServerInfo('');
    try {
      const result = await api.health();
      if (result.status === 'ok') {
        setConnectionStatus('connected');
        setServerInfo(
          mode === 'local'
            ? `Local engine ready. Beacons: ${result.beacons.join(', ')}`
            : `Remote backend ready. Beacons: ${result.beacons.join(', ')}`,
        );
      } else {
        setConnectionStatus('failed');
        setServerInfo('Server responded but status is not ok');
      }
    } catch (err: any) {
      setConnectionStatus('failed');
      setServerInfo(err.message || 'Cannot reach server');
    }
  }, [mode]);

  const statusColor =
    connectionStatus === 'connected'
      ? '#3fb950'
      : connectionStatus === 'failed'
        ? '#f85149'
        : connectionStatus === 'testing'
          ? '#d29922'
          : '#8b949e';

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'failed'
        ? 'Failed'
        : connectionStatus === 'testing'
          ? 'Testing...'
          : 'Not tested';

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>
        Run positioning on this phone, or switch back to the Flask backend
        when you want to compare against the laptop server.
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>Positioning Mode</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'local' && styles.modeButtonActive,
            ]}
            onPress={() => handleModeChange('local')}>
            <Text
              style={[
                styles.modeButtonText,
                mode === 'local' && styles.modeButtonTextActive,
              ]}>
              Local Phone
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeButton,
              mode === 'remote' && styles.modeButtonActive,
            ]}
            onPress={() => handleModeChange('remote')}>
            <Text
              style={[
                styles.modeButtonText,
                mode === 'remote' && styles.modeButtonTextActive,
              ]}>
              Flask Fallback
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Local mode uses bundled fingerprint data and saves edits on this
          phone. Flask fallback uses the laptop server URL below.
        </Text>
      </View>

      {mode === 'remote' ? (
        <View style={styles.section}>
          <Text style={styles.label}>Flask Backend URL:</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.100:5001"
            placeholderTextColor="#6e7681"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            Enter the IP of the machine running the Flask backend.{'\n'}
            Example: http://192.168.1.100:5001
          </Text>
        </View>
      ) : null}

      <View style={styles.buttonRow}>
        {mode === 'remote' ? (
          <TouchableOpacity style={styles.buttonPrimary} onPress={handleSave}>
            <Text style={styles.buttonText}>Save URL</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.buttonSecondary} onPress={testConnection}>
          <Text style={styles.buttonText}>
            {mode === 'local' ? 'Check Local Engine' : 'Test Connection'}
          </Text>
        </TouchableOpacity>
      </View>

      {saved ? (
        <View style={styles.savedBox}>
          <Text style={styles.savedText}>URL saved successfully</Text>
        </View>
      ) : null}

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Connection Status</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
          <Text style={[styles.statusLabel, {color: statusColor}]}>
            {statusLabel}
          </Text>
        </View>
        {serverInfo ? (
          <Text style={styles.serverInfo}>{serverInfo}</Text>
        ) : null}
        <Text style={styles.currentUrl}>
          Current mode: {getApiMode() === 'local' ? 'Local Phone' : 'Flask Fallback'}
        </Text>
        {mode === 'remote' ? (
          <Text style={styles.currentUrl}>Current URL: {getApiUrl()}</Text>
        ) : null}
      </View>

      <View style={styles.helpCard}>
        <Text style={styles.helpTitle}>How it works</Text>
        <Text style={styles.helpText}>
          Local mode keeps BLE scanning, fingerprint matching, Kalman
          smoothing, survey storage, and routing inside the app.{'\n'}
          Flask fallback is still available when a laptop backend is running.
        </Text>
      </View>
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
    marginBottom: 16,
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
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 12,
    color: '#6e7681',
    marginTop: 6,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: '#58a6ff',
    backgroundColor: '#10223a',
  },
  modeButtonText: {
    color: '#8b949e',
    fontSize: 14,
    fontWeight: '700',
  },
  modeButtonTextActive: {
    color: '#e6edf3',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: '#238636',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: '#1f6feb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  savedBox: {
    padding: 10,
    backgroundColor: '#0d2818',
    borderWidth: 1,
    borderColor: '#238636',
    borderRadius: 8,
    marginBottom: 16,
  },
  savedText: {
    color: '#3fb950',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  serverInfo: {
    fontSize: 13,
    color: '#8b949e',
    marginBottom: 4,
  },
  currentUrl: {
    fontSize: 13,
    color: '#6e7681',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  helpCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 40,
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#58a6ff',
    marginBottom: 8,
  },
  helpText: {
    fontSize: 13,
    color: '#8b949e',
    lineHeight: 22,
  },
});
