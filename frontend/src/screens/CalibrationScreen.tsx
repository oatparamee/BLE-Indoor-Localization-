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
  Modal,
} from 'react-native';
import {bleScanner, BeaconReading} from '../services/bleScanner';
import {api} from '../services/api';
import {N as CONFIG_N} from '../config/beacons';

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

  // -------------------------------------------------------------------
  // Adaptive 2D Q/R calibration (trilateration + 2D Kalman filter)
  // Runs alongside but independent of the basic sample-collect flow above.
  // -------------------------------------------------------------------
  type AdaptStatus = 'STABLE' | 'LAGGING' | 'JUMPY';

  interface AdaptSlot {
    id: string;
    name: string;
    rssi1m: string;
    x: string;
    y: string;
  }

  interface AdaptConfig {
    id: string;
    name: string;
    rssi1m: number;
    x: number;
    y: number;
  }

  interface AdaptLogLine {
    n: number;
    xRaw: number;
    yRaw: number;
    xEst: number;
    yEst: number;
    q: number;
    status: AdaptStatus;
  }

  interface AdaptSummary {
    total: number;
    R: number;
    finalQ: number;
    qr: number;
    envType: string;
    xEst: number;
    yEst: number;
  }

  const [adaptSlots, setAdaptSlots] = useState<(AdaptSlot | null)[]>([
    null,
    null,
    null,
  ]);
  const [adaptPickerOpen, setAdaptPickerOpen] = useState<number | null>(null);

  const [adaptRunning, setAdaptRunning] = useState(false);
  const [adaptPhase, setAdaptPhase] = useState<1 | 2>(1);
  const [adaptReadingCount, setAdaptReadingCount] = useState(0);
  const [adaptXRaw, setAdaptXRaw] = useState<number | null>(null);
  const [adaptYRaw, setAdaptYRaw] = useState<number | null>(null);
  const [adaptXEst, setAdaptXEst] = useState<number | null>(null);
  const [adaptYEst, setAdaptYEst] = useState<number | null>(null);
  const [adaptR, setAdaptR] = useState<number | null>(null);
  const [adaptQ, setAdaptQ] = useState<number | null>(null);
  const [adaptStatus, setAdaptStatus] = useState<AdaptStatus>('STABLE');
  const [adaptMessage, setAdaptMessage] = useState<string>('');
  const [adaptLog, setAdaptLog] = useState<AdaptLogLine[]>([]);
  const [adaptSummary, setAdaptSummary] = useState<AdaptSummary | null>(null);

  const PHASE1_SAMPLE_COUNT = 60;
  const PHASE1_MAX_RANGE_M = 2.0;

  const adaptConfigRef = useRef<AdaptConfig[]>([]);
  const adaptPhaseRef = useRef<1 | 2>(1);
  const adaptCountRef = useRef(0);
  const adaptStationaryXRef = useRef<number[]>([]);
  const adaptStationaryYRef = useRef<number[]>([]);
  const adaptRRef = useRef<number | null>(null);
  const adaptQRef = useRef<number | null>(null);
  const adaptPxRef = useRef(1.0);
  const adaptPyRef = useRef(1.0);
  const adaptXEstRef = useRef<number | null>(null);
  const adaptYEstRef = useRef<number | null>(null);
  const adaptInnovationsRef = useRef<number[]>([]);
  const adaptStatusRef = useRef<AdaptStatus>('STABLE');
  const adaptIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // -------------------------------------------------------------------
  // Adaptive 2D Q/R Calibration helpers
  // -------------------------------------------------------------------
  const rssiToDistance2D = (
    rssi: number,
    rssi1m: number,
    n: number,
  ): number => {
    return Math.pow(10, (rssi1m - rssi) / (10 * n));
  };

  /**
   * Standard algebraic trilateration for 3 beacons in 2D.
   * Returns [x_raw, y_raw] or null if the geometry is degenerate.
   */
  const trilaterate2D = (
    positions: [number, number][],
    distances: [number, number, number],
  ): [number, number] | null => {
    const [[x1, y1], [x2, y2], [x3, y3]] = positions;
    const [d1, d2, d3] = distances;
    const A = 2 * (x2 - x1);
    const B = 2 * (y2 - y1);
    const C =
      d1 * d1 - d2 * d2 - x1 * x1 + x2 * x2 - y1 * y1 + y2 * y2;
    const D = 2 * (x3 - x2);
    const E = 2 * (y3 - y2);
    const F =
      d2 * d2 - d3 * d3 - x2 * x2 + x3 * x3 - y2 * y2 + y3 * y3;
    const denomX = A * E - B * D;
    const denomY = B * D - A * E;
    if (!Number.isFinite(denomX) || !Number.isFinite(denomY)) return null;
    if (denomX === 0 || denomY === 0) return null;
    const x = (C * E - F * B) / denomX;
    const y = (C * D - A * F) / denomY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  };

  const classifyEnv = (qr: number): string => {
    if (qr < 0.02) return 'Low movement — office or stationary use';
    if (qr < 0.05) return 'Normal indoor walking';
    if (qr < 0.1) return 'Fast movement or high obstruction';
    return 'Very dynamic — consider retuning n';
  };

  const adaptUpdateSlot = useCallback(
    (index: number, field: keyof AdaptSlot, value: string) => {
      setAdaptSlots(prev => {
        const next = [...prev];
        const slot = next[index];
        if (!slot) return prev;
        next[index] = {...slot, [field]: value};
        return next;
      });
    },
    [],
  );

  const adaptPickBeacon = useCallback(
    (index: number, device: BeaconReading) => {
      setAdaptSlots(prev => {
        const next = [...prev];
        next[index] = {
          id: device.id,
          name: device.name,
          rssi1m: next[index]?.rssi1m ?? '-59',
          x: next[index]?.x ?? '0',
          y: next[index]?.y ?? '0',
        };
        return next;
      });
      setAdaptPickerOpen(null);
    },
    [],
  );

  const adaptClearSlot = useCallback((index: number) => {
    setAdaptSlots(prev => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const resetAdaptState = useCallback(() => {
    adaptPhaseRef.current = 1;
    adaptCountRef.current = 0;
    adaptStationaryXRef.current = [];
    adaptStationaryYRef.current = [];
    adaptRRef.current = null;
    adaptQRef.current = null;
    adaptPxRef.current = 1.0;
    adaptPyRef.current = 1.0;
    adaptXEstRef.current = null;
    adaptYEstRef.current = null;
    adaptInnovationsRef.current = [];
    adaptStatusRef.current = 'STABLE';

    setAdaptPhase(1);
    setAdaptReadingCount(0);
    setAdaptXRaw(null);
    setAdaptYRaw(null);
    setAdaptXEst(null);
    setAdaptYEst(null);
    setAdaptR(null);
    setAdaptQ(null);
    setAdaptStatus('STABLE');
    setAdaptMessage('');
    setAdaptLog([]);
    setAdaptSummary(null);
  }, []);

  const adaptiveTick = useCallback(() => {
    const cfg = adaptConfigRef.current;
    if (cfg.length !== 3) return;

    const live = bleScanner.getReadings();
    const rssis: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = live[cfg[i].id];
      if (
        !b ||
        b.rawRssi === null ||
        b.rawRssi === undefined ||
        !b.active
      ) {
        setAdaptMessage(
          `Waiting for beacon ${i + 1} (${cfg[i].name})...`,
        );
        return;
      }
      rssis.push(b.rawRssi);
    }

    const distances: [number, number, number] = [
      rssiToDistance2D(rssis[0], cfg[0].rssi1m, CONFIG_N),
      rssiToDistance2D(rssis[1], cfg[1].rssi1m, CONFIG_N),
      rssiToDistance2D(rssis[2], cfg[2].rssi1m, CONFIG_N),
    ];

    const positions: [number, number][] = [
      [cfg[0].x, cfg[0].y],
      [cfg[1].x, cfg[1].y],
      [cfg[2].x, cfg[2].y],
    ];

    const tri = trilaterate2D(positions, distances);
    if (!tri) {
      setAdaptMessage(
        'Trilateration failed (degenerate beacon geometry). Check positions.',
      );
      return;
    }
    const [xRaw, yRaw] = tri;

    adaptCountRef.current += 1;
    const n = adaptCountRef.current;

    setAdaptReadingCount(n);
    setAdaptXRaw(xRaw);
    setAdaptYRaw(yRaw);

    // ---------- PHASE 1 ----------
    if (adaptPhaseRef.current === 1) {
      adaptStationaryXRef.current.push(xRaw);
      adaptStationaryYRef.current.push(yRaw);

      const len = adaptStationaryXRef.current.length;
      if (len < PHASE1_SAMPLE_COUNT) {
        setAdaptMessage(
          `Stand still. Collecting ${len}/${PHASE1_SAMPLE_COUNT} readings to calibrate R...`,
        );
        return;
      }

      const xs = adaptStationaryXRef.current;
      const ys = adaptStationaryYRef.current;

      // Sanity check: did the user actually stand still?
      const xRange = Math.max(...xs) - Math.min(...xs);
      const yRange = Math.max(...ys) - Math.min(...ys);
      if (xRange > PHASE1_MAX_RANGE_M || yRange > PHASE1_MAX_RANGE_M) {
        Alert.alert(
          'Phase 1 failed',
          `Position varied by ${xRange.toFixed(2)}m × ${yRange.toFixed(2)}m. ` +
            `That looks like movement, not noise. Restarting Phase 1 — please stand still.`,
        );
        adaptStationaryXRef.current = [];
        adaptStationaryYRef.current = [];
        adaptCountRef.current = 0;
        setAdaptReadingCount(0);
        return;
      }

      const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
      const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
      const varX = xs.reduce((a, b) => a + (b - meanX) ** 2, 0) / xs.length;
      const varY = ys.reduce((a, b) => a + (b - meanY) ** 2, 0) / ys.length;
      const R = Math.max((varX + varY) / 2, 1e-6);
      const Q = R * 0.01;

      adaptRRef.current = R;
      adaptQRef.current = Q;
      adaptXEstRef.current = meanX;
      adaptYEstRef.current = meanY;
      // Initialize P with R — we just measured position uncertainty, so R is the right initial P
      adaptPxRef.current = R;
      adaptPyRef.current = R;
      adaptInnovationsRef.current = [];
      adaptPhaseRef.current = 2;

      setAdaptR(R);
      setAdaptQ(Q);
      setAdaptXEst(meanX);
      setAdaptYEst(meanY);
      setAdaptPhase(2);
      const msg = `R calibrated = ${R.toFixed(4)} m  |  Q start = ${Q.toFixed(5)}  |  Now start walking.`;
      setAdaptMessage(msg);
      Alert.alert('Phase 1 complete', msg);
      return;
    }

    // ---------- PHASE 2 ----------
    const R = adaptRRef.current!;
    let Q = adaptQRef.current!;
    let xEst = adaptXEstRef.current!;
    let yEst = adaptYEstRef.current!;
    let Px = adaptPxRef.current;
    let Py = adaptPyRef.current;

    // Predict step
    const pxPred = Px + Q;
    const pyPred = Py + Q;

    // Innovation BEFORE update
    const innovX = xRaw - xEst;
    const innovY = yRaw - yEst;

    // Innovation covariance
    const Sx = pxPred + R;
    const Sy = pyPred + R;

    // Proper 2D NIS — should average to ~2 when filter is well-tuned
    const nis = (innovX ** 2) / Sx + (innovY ** 2) / Sy;

    // Kalman gains
    const Kx = pxPred / Sx;
    const Ky = pyPred / Sy;

    // Update step
    xEst = xEst + Kx * innovX;
    yEst = yEst + Ky * innovY;
    Px = (1 - Kx) * pxPred;
    Py = (1 - Ky) * pyPred;

    adaptXEstRef.current = xEst;
    adaptYEstRef.current = yEst;
    adaptPxRef.current = Px;
    adaptPyRef.current = Py;

    const windowSize = 20;

    adaptInnovationsRef.current.push(nis);
    if (adaptInnovationsRef.current.length > windowSize) {
      adaptInnovationsRef.current.shift();
    }

    let status = adaptStatusRef.current;
    const phase2Count = n - PHASE1_SAMPLE_COUNT;
    if (
      phase2Count > 0 &&
      phase2Count % 10 === 0 &&
      adaptInnovationsRef.current.length >= 10
    ) {
      const window = adaptInnovationsRef.current;
      const meanNis = window.reduce((a, b) => a + b, 0) / window.length;
      const ratio = meanNis / 2; // 2 = expected NIS for 2D filter
      const lowBound = R * 0.01;
      const highBound = R * 0.1;

      // Dampened update — only move 20% toward target each adjustment
      const target = Q * ratio;
      const alpha = 0.2;
      let newQ = Q + alpha * (target - Q);
      newQ = Math.max(lowBound, Math.min(highBound, newQ));

      if (ratio > 1.2) {
        status = 'LAGGING';
      } else if (ratio < 0.8) {
        status = 'JUMPY';
      } else {
        status = 'STABLE';
      }

      Q = newQ;
      adaptQRef.current = Q;
      adaptStatusRef.current = status;
    }

    setAdaptXEst(xEst);
    setAdaptYEst(yEst);
    setAdaptQ(Q);
    setAdaptStatus(status);
    setAdaptMessage(
      `[${n}] Raw:(${xRaw.toFixed(2)},${yRaw.toFixed(2)})m | Est:(${xEst.toFixed(2)},${yEst.toFixed(2)})m | Q=${Q.toFixed(5)} | ${status}`,
    );
    setAdaptLog(prev => {
      const next = [...prev, {n, xRaw, yRaw, xEst, yEst, q: Q, status}];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });
  }, []);

  const startAdaptive = useCallback(() => {
    // Validate all 3 slots before we kick anything off.
    const parsed: AdaptConfig[] = [];
    for (let i = 0; i < 3; i++) {
      const s = adaptSlots[i];
      if (!s) {
        Alert.alert(
          'Incomplete setup',
          `Please pick a beacon for slot ${i + 1}.`,
        );
        return;
      }
      const rssi1m = parseFloat(s.rssi1m);
      const x = parseFloat(s.x);
      const y = parseFloat(s.y);
      if (!Number.isFinite(rssi1m)) {
        Alert.alert(
          'Invalid rssi_1m',
          `Slot ${i + 1}: rssi_1m must be a number (dBm).`,
        );
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        Alert.alert(
          'Invalid position',
          `Slot ${i + 1}: x and y must be numbers (meters).`,
        );
        return;
      }
      parsed.push({id: s.id, name: s.name, rssi1m, x, y});
    }

    const ids = new Set(parsed.map(p => p.id));
    if (ids.size !== 3) {
      Alert.alert(
        'Duplicate beacon',
        'Please pick three DIFFERENT BLE beacons.',
      );
      return;
    }

    adaptConfigRef.current = parsed;
    resetAdaptState();
    setAdaptRunning(true);
    setAdaptMessage('Stand still. Collecting 30 readings to calibrate R...');
    adaptiveTick();
    adaptIntervalRef.current = setInterval(adaptiveTick, 1000);
  }, [adaptSlots, adaptiveTick, resetAdaptState]);

  const finishAdaptive = useCallback(() => {
    if (adaptIntervalRef.current) {
      clearInterval(adaptIntervalRef.current);
      adaptIntervalRef.current = null;
    }
    setAdaptRunning(false);

    const total = adaptCountRef.current;
    const R = adaptRRef.current;
    const Q = adaptQRef.current;
    const xEst = adaptXEstRef.current;
    const yEst = adaptYEstRef.current;

    if (
      R === null ||
      Q === null ||
      xEst === null ||
      yEst === null
    ) {
      setAdaptMessage(
        `Stopped after ${total} readings — phase 1 did not complete.`,
      );
      return;
    }

    const qr = Q / R;
    setAdaptSummary({
      total,
      R,
      finalQ: Q,
      qr,
      envType: classifyEnv(qr),
      xEst,
      yEst,
    });
    setAdaptMessage(`Done. Total readings: ${total}.`);
  }, []);

  const applyAdaptiveToBackend = useCallback(async () => {
    if (!adaptSummary) return;
    try {
      const result = await api.kalmanInitialize(
        adaptSummary.finalQ,
        adaptSummary.R,
      );
      setAdaptMessage(
        `Kalman initialized on backend — Q: ${result.Q}, R: ${result.R}`,
      );
    } catch (err: any) {
      setAdaptMessage(`Error pushing values to backend: ${err.message}`);
    }
  }, [adaptSummary]);

  useEffect(() => {
    return () => {
      if (adaptIntervalRef.current) {
        clearInterval(adaptIntervalRef.current);
        adaptIntervalRef.current = null;
      }
    };
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

      {/* ============= Adaptive 2D Q/R Calibration ============= */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Adaptive Q/R Calibration (2D, 3-beacon)
        </Text>
        <Text style={styles.nHint}>
          Pick 3 different BLE beacons and enter each one's rssi_1m and
          (x, y) position in meters. Phase 1: stand still for 30 readings —
          the app trilaterates and measures position variance to get R.
          Phase 2: walk around. A 2D Kalman filter runs live and retunes Q
          every 10 readings based on the innovation ratio. Tap Done when
          you're finished walking.
        </Text>

        {[0, 1, 2].map(i => {
          const slot = adaptSlots[i];
          return (
            <View key={i} style={styles.adaptSlotCard}>
              <View style={styles.adaptSlotHeader}>
                <Text style={styles.adaptSlotTitle}>Beacon {i + 1}</Text>
                {slot ? (
                  <TouchableOpacity onPress={() => adaptClearSlot(i)}>
                    <Text style={styles.adaptSlotClear}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.adaptPickerButton}
                onPress={() => setAdaptPickerOpen(i)}
                disabled={adaptRunning}>
                <Text style={styles.adaptPickerButtonText}>
                  {slot ? slot.name : 'Pick a detected beacon...'}
                </Text>
                {slot ? (
                  <Text style={styles.adaptPickerButtonSub}>
                    {slot.id.substring(0, 16)}
                  </Text>
                ) : null}
              </TouchableOpacity>

              <View style={styles.adaptFieldRow}>
                <View style={styles.adaptField}>
                  <Text style={styles.adaptFieldLabel}>rssi_1m (dBm)</Text>
                  <TextInput
                    style={styles.input}
                    value={slot?.rssi1m ?? ''}
                    onChangeText={v => adaptUpdateSlot(i, 'rssi1m', v)}
                    keyboardType="numeric"
                    placeholder="-59"
                    placeholderTextColor="#6e7681"
                    editable={!!slot && !adaptRunning}
                  />
                </View>
                <View style={styles.adaptField}>
                  <Text style={styles.adaptFieldLabel}>x (m)</Text>
                  <TextInput
                    style={styles.input}
                    value={slot?.x ?? ''}
                    onChangeText={v => adaptUpdateSlot(i, 'x', v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#6e7681"
                    editable={!!slot && !adaptRunning}
                  />
                </View>
                <View style={styles.adaptField}>
                  <Text style={styles.adaptFieldLabel}>y (m)</Text>
                  <TextInput
                    style={styles.input}
                    value={slot?.y ?? ''}
                    onChangeText={v => adaptUpdateSlot(i, 'y', v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#6e7681"
                    editable={!!slot && !adaptRunning}
                  />
                </View>
              </View>
            </View>
          );
        })}

        {!adaptRunning ? (
          <TouchableOpacity
            style={styles.buttonPrimary}
            onPress={startAdaptive}>
            <Text style={styles.buttonText}>
              Start Adaptive Q/R Calibration
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.buttonDanger}
            onPress={finishAdaptive}>
            <Text style={styles.buttonText}>Done</Text>
          </TouchableOpacity>
        )}

        <View style={styles.kStatsRow}>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Phase</Text>
            <Text style={styles.kStatValue}>{adaptPhase}</Text>
          </View>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Readings</Text>
            <Text style={styles.kStatValue}>{adaptReadingCount}</Text>
          </View>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Status</Text>
            <Text
              style={[
                styles.kStatValue,
                {
                  color:
                    adaptStatus === 'STABLE'
                      ? '#3fb950'
                      : adaptStatus === 'LAGGING'
                      ? '#d29922'
                      : '#f85149',
                },
              ]}>
              {adaptStatus}
            </Text>
          </View>
        </View>

        <View style={styles.kStatsRow}>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Raw (x, y) m</Text>
            <Text style={styles.kStatValueMono}>
              {adaptXRaw !== null && adaptYRaw !== null
                ? `${adaptXRaw.toFixed(2)}, ${adaptYRaw.toFixed(2)}`
                : '—'}
            </Text>
          </View>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Est (x, y) m</Text>
            <Text style={styles.kStatValueMono}>
              {adaptXEst !== null && adaptYEst !== null
                ? `${adaptXEst.toFixed(2)}, ${adaptYEst.toFixed(2)}`
                : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.kStatsRow}>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>R (m²)</Text>
            <Text style={styles.kStatValueMono}>
              {adaptR !== null ? adaptR.toFixed(4) : '—'}
            </Text>
          </View>
          <View style={styles.kStat}>
            <Text style={styles.kStatLabel}>Q</Text>
            <Text style={styles.kStatValueMono}>
              {adaptQ !== null ? adaptQ.toFixed(5) : '—'}
            </Text>
          </View>
        </View>

        {adaptMessage ? (
          <Text style={styles.kMessage}>{adaptMessage}</Text>
        ) : null}

        {adaptLog.length > 0 ? (
          <View style={styles.kLogBox}>
            <Text style={styles.kLogHeader}>
              Latest readings (most recent at bottom)
            </Text>
            <ScrollView style={styles.kLogScroll}>
              {adaptLog.slice(-30).map(entry => (
                <Text key={entry.n} style={styles.kLogLine}>
                  [{entry.n}] Raw:({entry.xRaw.toFixed(2)},
                  {entry.yRaw.toFixed(2)})m | Est:(
                  {entry.xEst.toFixed(2)},{entry.yEst.toFixed(2)})m | Q=
                  {entry.q.toFixed(5)} | {entry.status}
                </Text>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {adaptSummary ? (
          <View style={styles.nResultBox}>
            <Text style={styles.nResultLabel}>--- Session Summary ---</Text>
            <Text style={styles.kSummaryLine}>
              Total readings    :{' '}
              <Text style={styles.kSummaryVal}>{adaptSummary.total}</Text>
            </Text>
            <Text style={styles.kSummaryLine}>
              R (position noise):{' '}
              <Text style={styles.kSummaryVal}>
                {adaptSummary.R.toFixed(4)} m
              </Text>
            </Text>
            <Text style={styles.kSummaryLine}>
              Final Q           :{' '}
              <Text style={styles.kSummaryVal}>
                {adaptSummary.finalQ.toFixed(5)}
              </Text>
            </Text>
            <Text style={styles.kSummaryLine}>
              Q/R ratio         :{' '}
              <Text style={styles.kSummaryVal}>
                {adaptSummary.qr.toFixed(4)}
              </Text>
            </Text>
            <Text style={styles.kSummaryLine}>
              Environment type  :{' '}
              <Text style={styles.kSummaryVal}>{adaptSummary.envType}</Text>
            </Text>
            <Text style={styles.kSummaryLine}>
              Estimated position:{' '}
              <Text style={styles.kSummaryVal}>
                ({adaptSummary.xEst.toFixed(2)},{' '}
                {adaptSummary.yEst.toFixed(2)}) m
              </Text>
            </Text>
            <TouchableOpacity
              style={styles.buttonSuccess}
              onPress={applyAdaptiveToBackend}>
              <Text style={styles.buttonText}>
                Apply to Backend Kalman Filter
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Beacon picker modal for the adaptive section */}
      <Modal
        visible={adaptPickerOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAdaptPickerOpen(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Pick beacon for slot{' '}
                {adaptPickerOpen !== null ? adaptPickerOpen + 1 : ''}
              </Text>
              <TouchableOpacity
                onPress={() => setAdaptPickerOpen(null)}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            {detectedBeacons.length === 0 ? (
              <Text style={styles.modalEmpty}>
                No BLE devices detected yet. Keep the screen open while
                the scanner warms up.
              </Text>
            ) : (
              <ScrollView style={styles.modalList}>
                {detectedBeacons.map(dev => {
                  const takenInAnotherSlot = adaptSlots.some(
                    (s, idx) =>
                      s !== null &&
                      s.id === dev.id &&
                      idx !== adaptPickerOpen,
                  );
                  return (
                    <TouchableOpacity
                      key={dev.id}
                      style={[
                        styles.modalRow,
                        takenInAnotherSlot && styles.modalRowTaken,
                      ]}
                      disabled={takenInAnotherSlot}
                      onPress={() => {
                        if (adaptPickerOpen !== null) {
                          adaptPickBeacon(adaptPickerOpen, dev);
                        }
                      }}>
                      <View style={{flex: 1}}>
                        <Text style={styles.modalRowName}>{dev.name}</Text>
                        <Text style={styles.modalRowId}>{dev.id}</Text>
                      </View>
                      <Text style={styles.modalRowRssi}>
                        {dev.rawRssi !== null ? `${dev.rawRssi} dBm` : '—'}
                      </Text>
                      {takenInAnotherSlot ? (
                        <Text style={styles.modalRowBadge}>in use</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
  adaptSlotCard: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  adaptSlotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  adaptSlotTitle: {
    color: '#e6edf3',
    fontSize: 15,
    fontWeight: '700',
  },
  adaptSlotClear: {
    color: '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
  adaptPickerButton: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  adaptPickerButtonText: {
    color: '#58a6ff',
    fontSize: 14,
    fontWeight: '600',
  },
  adaptPickerButtonSub: {
    color: '#6e7681',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  adaptFieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  adaptField: {
    flex: 1,
  },
  adaptFieldLabel: {
    color: '#8b949e',
    fontSize: 11,
    marginBottom: 4,
  },
  kStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  kStat: {
    flex: 1,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  kStatLabel: {
    color: '#8b949e',
    fontSize: 11,
    marginBottom: 4,
  },
  kStatValue: {
    color: '#e6edf3',
    fontSize: 16,
    fontWeight: '700',
  },
  kStatValueMono: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  kMessage: {
    color: '#58a6ff',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 10,
    lineHeight: 18,
  },
  kLogBox: {
    marginTop: 12,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 8,
  },
  kLogHeader: {
    color: '#8b949e',
    fontSize: 11,
    marginBottom: 6,
  },
  kLogScroll: {
    maxHeight: 200,
  },
  kLogLine: {
    color: '#c9d1d9',
    fontSize: 11,
    fontFamily: 'monospace',
    paddingVertical: 1,
  },
  kSummaryLine: {
    color: '#c9d1d9',
    fontSize: 13,
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  kSummaryVal: {
    color: '#3fb950',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: '#e6edf3',
    fontSize: 16,
    fontWeight: '700',
  },
  modalClose: {
    color: '#58a6ff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalEmpty: {
    color: '#6e7681',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalList: {
    maxHeight: 400,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
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
    color: '#58a6ff',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  modalRowBadge: {
    color: '#d29922',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 6,
    textTransform: 'uppercase',
  },
});
