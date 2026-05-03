# BLE Indoor Localization System

Indoor positioning using BLE beacons and a phone running a React Native app, with a Flask backend for trilateration and Kalman filtering.

## Architecture

```text
Phone (React Native)          Flask Backend (Mac/PC)
--------------------          ----------------------
BLE scan -> RSSI        -->   /position
Calibration samples     -->   /calibrate/sample
Settings/API checks     -->   /health

                              RSSI -> distance
                              Trilateration
                              Adaptive Kalman filter

                         <--  raw and smoothed (x, y)
```

- **BLE beacons** broadcast nearby signal readings.
- **React Native app** scans BLE devices, lets the user select beacons, and sends readings to the backend.
- **Flask backend** computes distances, trilateration, and Kalman-smoothed position.

## Project Layout

```text
backend/        Flask API, trilateration, calibration, Kalman filter
frontend/       React Native app used for Android/iOS backend testing
frontend/ios/   Native iOS project opened with Xcode
BLEScannerRN/   Separate UI branch app files
```

## Backend Setup

From the repo root:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Run the backend:

```bash
.venv/bin/flask --app app run --host 0.0.0.0 --port 5001
```

The health check endpoint is:

```text
http://127.0.0.1:5001/health
```

The app can also use `python app.py`, but that defaults to port `5000`. On macOS, port `5000` is often taken by AirPlay Receiver, so `5001` is the recommended development port.

## iPhone / Xcode Test App Setup

These steps are for teammates who want to build the current `main` branch on their own MacBook and install it on an iPhone through Xcode.

### 1. Prerequisites

Install:

- Xcode from the Mac App Store
- Xcode command line tools
- Node.js and npm
- CocoaPods
- ngrok, if testing on a network that blocks phone-to-Mac traffic

Useful checks:

```bash
xcode-select -p
node -v
npm -v
pod --version
ngrok version
```

If CocoaPods is missing:

```bash
sudo gem install cocoapods
```

### 2. Pull the Project

```bash
git clone <repo-url>
cd BLE-Indoor-Localization-
git switch main
git pull --ff-only origin main
```

If the repo already exists locally:

```bash
cd BLE-Indoor-Localization-
git switch main
git pull --ff-only origin main
```

### 3. Install JavaScript Dependencies

```bash
cd frontend
npm install
```

### 4. Install iOS Pods

Still inside `frontend`:

```bash
cd ios
printf 'export NODE_BINARY=%s\n' "$(which node)" > .xcode.env.local
pod install
```

The `.xcode.env.local` file is intentionally local-only because every teammate may have Node installed at a different path.

Always open the workspace, not the project file:

```bash
open BLEIndoorLocalization.xcworkspace
```

Use:

```text
frontend/ios/BLEIndoorLocalization.xcworkspace
```

Do not use:

```text
frontend/ios/BLEIndoorLocalization.xcodeproj
```

### 5. Configure Xcode Signing

In Xcode:

1. Select the `BLEIndoorLocalization` project.
2. Select the `BLEIndoorLocalization` target.
3. Open **Signing & Capabilities**.
4. Choose your own Apple Team.
5. Plug in your iPhone and trust the Mac if prompted.
6. Select your iPhone as the run destination.

If Xcode still shows old build errors after installing pods, use:

```text
Product -> Clean Build Folder
```

Then press **Run** again.

### 6. Start Metro

In a separate terminal:

```bash
cd frontend
npm start
```

Leave Metro running while the app is open on the iPhone.

### 7. Start the Flask Backend

In another terminal:

```bash
cd backend
.venv/bin/flask --app app run --host 0.0.0.0 --port 5001
```

Leave this running too.

### 8. Choose the Backend URL

Open the app on the iPhone and go to the **Settings** tab.

For a private network where the iPhone can reach the Mac directly, find the Mac IP:

```bash
ipconfig getifaddr en0
```

Then enter:

```text
http://YOUR_MAC_IP:5001
```

For UCLA/university Wi-Fi or other networks that block device-to-device traffic, use ngrok instead:

```bash
ngrok http 5001
```

Copy the HTTPS forwarding URL from ngrok, for example:

```text
https://example-name.ngrok-free.dev
```

Enter that exact URL in the app's **Backend Server URL** field. Do not add `/health`; the app adds endpoint paths itself.

Tap **Save**, then **Test Connection**.

### 9. Run on iPhone

With Metro and Flask running:

1. In Xcode, select the `BLEIndoorLocalization` scheme.
2. Select the plugged-in iPhone.
3. Press **Run**.
4. Allow Bluetooth and Local Network permissions if iOS asks.
5. In the app, set the backend URL in Settings.
6. Use the Calibration, Live Readings, and Position tabs for testing.

After the app is installed, JavaScript changes usually only need a Metro reload. Native iOS changes, Pods, permissions, signing, or `Info.plist` changes require another Xcode rebuild.

## Common iOS Troubleshooting

### Xcode says Pods config files are missing

Open the workspace only after running:

```bash
cd frontend/ios
pod install
open BLEIndoorLocalization.xcworkspace
```

### Xcode cannot find Node

Regenerate the local Node path file:

```bash
cd frontend/ios
printf 'export NODE_BINARY=%s\n' "$(which node)" > .xcode.env.local
```

Then clean and rebuild in Xcode.

### App cannot connect to backend on university Wi-Fi

Campus Wi-Fi often blocks phone-to-Mac local traffic. Use ngrok:

```bash
ngrok http 5001
```

Then use the `https://...ngrok-free.dev` URL in the app Settings tab.

### App shows an App Transport Security HTTP error

Use an HTTPS ngrok URL, or test on a private Wi-Fi network where local HTTP is allowed by the app configuration.

### Rebuild or reload?

Use Metro reload for:

- `frontend/App.tsx`
- `frontend/src/...`
- screen/service/config TypeScript changes

Rebuild in Xcode for:

- `frontend/ios/...`
- `Podfile` or `Podfile.lock`
- native dependency changes
- permissions or `Info.plist`
- signing settings

Restart Flask for:

- `backend/app.py`
- `backend/kalman_filter.py`
- `backend/trilateration.py`
- `backend/config.py`

## Android Phone Setup and Run (Windows)

These are the steps we used to run the app on a physical Android phone.

### 1. Prerequisites

Install:

- Android Studio (for SDK + platform tools)
- JDK 17 (Temurin/Adoptium recommended)
- Node.js + npm

In Android Studio, make sure these SDK components are installed:

- Android SDK Platform-Tools (includes `adb`)
- Android SDK Build-Tools
- Android SDK Command-line Tools

### 2. Use a local drive path (important)

Builds are much more reliable from a normal local path like:

```text
D:\dev\BLE-Indoor-Localization-
```

Avoid building from OneDrive paths, which can cause Gradle lock/cache errors.

### 3. Set environment variables (PowerShell)

Use your SDK path (example shown below):

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Users\su5ti\AppData\Local\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-17*", "User")
```

Add these to your User `Path`:

```text
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\cmdline-tools\latest\bin
%JAVA_HOME%\bin
```

Close and reopen terminal after this.

### 4. Authorize your Android device

On phone:

- Enable Developer Options
- Enable USB debugging
- Connect USB cable
- Accept "Allow USB debugging?" prompt
- If prompted, choose "Always allow from this computer"

On PC (PowerShell):

```powershell
adb kill-server
adb start-server
adb devices
```

Expected status must be:

```text
<device_id>    device
```

If it says `unauthorized`, revoke USB debugging authorizations on phone and reconnect.

### 5. Install frontend dependencies

```powershell
cd D:\dev\BLE-Indoor-Localization-\frontend
npm install
```

### 6. Run app + backend (3 terminals)

Terminal 1 (frontend Metro):

```powershell
cd D:\dev\BLE-Indoor-Localization-\frontend
npx react-native start --reset-cache
```

Terminal 2 (backend):

```powershell
cd D:\dev\BLE-Indoor-Localization-\backend
python app.py
```

Terminal 3 (install on Android):

```powershell
cd D:\dev\BLE-Indoor-Localization-\frontend
npx react-native run-android
```

### 7. Android-specific troubleshooting

- `adb is not recognized`:
  - `platform-tools` is not on `Path`, or terminal was not restarted.
- `Device is UNAUTHORIZED` / `No online devices found`:
  - re-do USB debugging authorization flow on the phone.
- `listen EADDRINUSE :::8081`:
  - Metro is already running; keep existing Metro, or stop old process and restart.
- Gradle metadata/cache lock errors:
  - stop Java/Gradle daemons, clear local Gradle cache folders, then rebuild.
  - avoid OneDrive project locations for Android build folders.

## Backend API Endpoints

### Health

```text
GET /health
```

### Calibration

```text
POST /calibrate/sample
Body: { "rssi": -65, "distance": 1.0 }

GET /calibrate/analyze

POST /calibrate/reset
Body: { "max_samples": 30 }
```

### Kalman Filter

```text
POST /kalman/initialize
Body: { "Q": 0.5, "R": 10.0 }

POST /kalman/update
Body: { "Q": 0.3 }

GET /kalman/status

POST /kalman/reset
```

### Position

The current app sends selected beacon positions directly:

```text
POST /position
Body:
{
  "beacons": [
    { "id": "uuid-1", "name": "Beacon 1", "x": 0, "y": 0, "rssi": -65 },
    { "id": "uuid-2", "name": "Beacon 2", "x": 6, "y": 0, "rssi": -72 },
    { "id": "uuid-3", "name": "Beacon 3", "x": 3, "y": 5, "rssi": -69 }
  ]
}
```

Response:

```json
{
  "distances": {
    "Beacon 1": 1.78,
    "Beacon 2": 3.55,
    "Beacon 3": 2.82
  },
  "raw_position": { "x": 2.31, "y": 1.87 },
  "smooth_position": { "x": 2.28, "y": 1.84 },
  "converged": false
}
```

## Beacon Coordinates

The app uses an `(x, y)` coordinate system in meters. The origin `(0, 0)` is whatever physical point the tester chooses, usually a room corner or the location of the first beacon.

Default placeholder coordinates are:

```text
Beacon_A: (0, 0)
Beacon_B: (6, 0)
Beacon_C: (3, 5)
```

For real testing, measure each beacon's physical location in meters and enter those positions in the Position tab.
