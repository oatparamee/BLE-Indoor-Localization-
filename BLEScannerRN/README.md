# BLE Scanner — React Native (Expo)

A React Native app built with Expo that scans for nearby BLE (Bluetooth Low Energy) devices and displays their signal strength (RSSI) in real time, with 1D Kalman filter smoothing.

## Setup

```bash
cd BLEScannerRN

# Install dependencies
npm install

# Generate native projects (required for react-native-ble-plx)
npx expo prebuild

# Run on iOS
npx expo run:ios

# Run on Android
npx expo run:android
```

> **Note:** BLE scanning requires a physical device. It will not work in the iOS Simulator or Android Emulator without Bluetooth hardware passthrough.

## Features

- Continuous BLE scanning for all nearby peripherals
- Device cards showing name, ID, raw RSSI, and Kalman-filtered RSSI
- Color-coded signal strength (green / yellow / red) with signal bars
- 1D Kalman Filter per device (Q=0.1, R=1.0, P=1.0)
- Bluetooth & location permission handling
- Auto-removal of stale devices after 10s
