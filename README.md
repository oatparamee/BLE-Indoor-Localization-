<<<<<<< HEAD
# BLE-Indoor-Localization-
=======
# BLE Indoor Localization System

Indoor positioning using BLE beacons (ESP32) and a phone running a React Native app, with a Flask backend for trilateration and Kalman filtering.

## Architecture

```
Phone (React Native)          Flask Backend (PC)
─────────────────             ─────────────────
BLE Scan → RSSI          ──→  /calibrate/sample
RSSI → Distance               /calibrate/analyze
Display live values      ──→  /position
                               ├─ RSSI → Distance
                               ├─ Trilateration
                               └─ Kalman Filter
                          ←──  smoothed (x, y)
```

- **3+ ESP32 beacons** — wall-mounted, broadcasting only (no code changes needed beyond standard BLE advertising with names `Beacon_A`, `Beacon_B`, `Beacon_C`)
- **Phone** — scans BLE, computes distance locally, sends RSSI to backend
- **Backend** — runs on local network, handles trilateration + Kalman filtering

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

The server starts on `http://0.0.0.0:5000`. Note your machine's local IP (e.g. `192.168.1.100`).

### Frontend (React Native)

```bash
cd frontend
npm install
```

**Before running**, edit the backend IP address in `frontend/src/config/api.ts`:

```typescript
export const API_BASE_URL = 'http://YOUR_PC_IP:5000';
```

Then run:

```bash
npx react-native run-android
# or
npx react-native run-ios
```

## Where to Change Beacon Config

Beacon positions, txPower, and path loss exponent are defined in **two files** that must stay in sync:

| Setting | Backend | Frontend |
|---------|---------|----------|
| Beacon positions & txPower | `backend/config.py` → `BEACONS` | `frontend/src/config/beacons.ts` → `BEACONS` |
| Path loss exponent N | `backend/config.py` → `N_DISTANCE` | `frontend/src/config/beacons.ts` → `N_DISTANCE` |

## API Endpoints (testable with Postman)

### Health Check
```
GET /health
```

### Calibration
```
POST /calibrate/sample
Body: { "rssi": -65, "distance": 1.0 }

GET /calibrate/analyze

POST /calibrate/reset
```

### Kalman Filter
```
POST /kalman/initialize
Body: { "Q": 0.5, "R": 10.0 }

POST /kalman/update
Body: { "Q": 0.3 }  or  { "R": 5.0 }  or both

GET /kalman/status

POST /kalman/reset
```

### Position
```
POST /position
Body: { "Beacon_A": -65, "Beacon_B": -72, "Beacon_C": -69 }

Response:
{
  "distances": { "Beacon_A": 1.78, "Beacon_B": 3.55, "Beacon_C": 2.82 },
  "raw_position": { "x": 2.31, "y": 1.87 },
  "smooth_position": { "x": 2.28, "y": 1.84 },
  "converged": false
}
```

## Pipeline

1. **BLE Scanning** (phone) — detects beacons, reads RSSI, rolling average of last 5
2. **Distance Calculation** (phone) — RSSI → meters via path loss model
3. **Calibration** (phone + backend) — collect 30 samples, compute noise stats, set Q/R
4. **Trilateration** (backend) — 3+ distances → (x, y) via least squares
5. **Kalman Filter** (backend) — smooths position, adapts R via innovation variance

## App Screens

- **Tab 1 — Calibration**: Collect RSSI samples at known distance, analyze noise, initialize Kalman
- **Tab 2 — Live Readings**: Raw RSSI, smoothed RSSI, distance per beacon, ACTIVE/LOST status
- **Tab 3 — Position**: Raw and smooth coordinates, Kalman effect delta, Q/R sliders, reset
>>>>>>> 0cf1add2df7a9b606a38f765a80aaf39ff189cba
