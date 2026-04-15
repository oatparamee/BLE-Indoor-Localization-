import {getApiUrl} from '../config/api';

async function post(path: string, body: object) {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${getApiUrl()}${path}`, {method: 'GET'});
  return res.json();
}

export const api = {
  health: () => get('/health'),

  calibrateSample: (rssi: number, distance: number) =>
    post('/calibrate/sample', {rssi, distance}),

  calibrateAnalyze: () => get('/calibrate/analyze'),

  calibrateReset: () => post('/calibrate/reset', {}),

  kalmanInitialize: (Q: number, R: number) =>
    post('/kalman/initialize', {Q, R}),

  kalmanUpdate: (params: {Q?: number; R?: number}) =>
    post('/kalman/update', params),

  kalmanStatus: () => get('/kalman/status'),

  kalmanReset: () => post('/kalman/reset', {}),

  position: (rssiMap: Record<string, number>) => post('/position', rssiMap),
};
