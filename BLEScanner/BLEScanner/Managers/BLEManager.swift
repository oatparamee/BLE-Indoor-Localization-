import Foundation
import CoreBluetooth
import Combine

// MARK: - BLE Manager
// Central manager that handles all Bluetooth Low Energy scanning.
// It acts as the CBCentralManagerDelegate to receive peripheral
// discovery events and publishes an observable list of devices
// for the SwiftUI views to consume.

class BLEManager: NSObject, ObservableObject {

    // MARK: - Published Properties (drive SwiftUI updates)

    /// List of all currently detected BLE devices, sorted by signal strength.
    @Published var devices: [BLEDevice] = []

    /// Whether the BLE scanner is actively scanning.
    @Published var isScanning: Bool = false

    /// Human-readable status message shown in the UI header.
    @Published var statusMessage: String = "Initializing Bluetooth..."

    /// Set to true when Bluetooth hardware is powered off,
    /// so the UI can show an alert prompting the user to enable it.
    @Published var showBluetoothOffAlert: Bool = false

    // MARK: - Private Properties

    /// The CoreBluetooth central manager that drives scanning.
    private var centralManager: CBCentralManager!

    /// Dictionary mapping peripheral UUID → KalmanFilter instance.
    /// Each device gets its own filter so RSSI smoothing is independent.
    private var kalmanFilters: [UUID: KalmanFilter] = [:]

    /// Timer that periodically removes stale devices that haven't
    /// been seen recently (e.g., moved out of range).
    private var cleanupTimer: Timer?

    /// How many seconds before a device is considered stale and removed.
    private let staleDeviceTimeout: TimeInterval = 10.0

    // MARK: - Initialization

    override init() {
        super.init()

        // Create the central manager on the main queue so delegate
        // callbacks arrive on the main thread (simplifies UI updates).
        centralManager = CBCentralManager(delegate: self, queue: nil)

        // Start a repeating timer that prunes devices not seen recently.
        startCleanupTimer()
    }

    // MARK: - Scanning Control

    /// Begins scanning for all nearby BLE peripherals.
    /// `allowDuplicates: true` ensures we receive repeated advertisements
    /// from the same device so we can track RSSI changes in real time.
    func startScanning() {
        guard centralManager.state == .poweredOn else {
            statusMessage = "Bluetooth is not available"
            return
        }

        // Scan for all service types (nil) and allow duplicate discoveries
        // so we get continuous RSSI updates for each device.
        centralManager.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: true
        ])

        isScanning = true
        statusMessage = "Scanning for BLE devices..."
    }

    /// Stops the BLE scan.
    func stopScanning() {
        centralManager.stopScan()
        isScanning = false
        statusMessage = "Scanning stopped"
    }

    // MARK: - Cleanup Timer

    /// Starts a background timer that removes devices not seen
    /// within `staleDeviceTimeout` seconds, keeping the list current.
    private func startCleanupTimer() {
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.removeStaleDevices()
        }
    }

    /// Filters out any device whose `lastSeen` timestamp is older
    /// than the stale threshold. Also removes its Kalman filter.
    private func removeStaleDevices() {
        let now = Date()
        let staleIDs = devices
            .filter { now.timeIntervalSince($0.lastSeen) > staleDeviceTimeout }
            .map { $0.id }

        // Remove stale Kalman filters to free memory.
        for id in staleIDs {
            kalmanFilters.removeValue(forKey: id)
        }

        // Update the published device list (triggers SwiftUI refresh).
        devices.removeAll { staleIDs.contains($0.id) }
    }

    // MARK: - Device Processing

    /// Called whenever a peripheral advertisement is received.
    /// Updates an existing device entry or creates a new one,
    /// applying the Kalman filter to smooth the RSSI reading.
    private func processDiscoveredPeripheral(
        _ peripheral: CBPeripheral,
        rssi: Int,
        advertisementData: [String: Any]
    ) {
        // Ignore invalid RSSI readings (127 means RSSI is unavailable).
        guard rssi != 127 else { return }

        let deviceID = peripheral.identifier

        // Determine device name: prefer the advertised local name,
        // fall back to the peripheral's name, or default to "Unknown".
        let deviceName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? peripheral.name
            ?? "Unknown"

        // Retrieve or create a Kalman filter for this device.
        let filter = kalmanFilters[deviceID] ?? KalmanFilter(
            processNoise: 0.1,
            measurementNoise: 1.0,
            initialEstimateError: 1.0
        )
        kalmanFilters[deviceID] = filter

        // Run the raw RSSI through the Kalman filter.
        let filteredValue = filter.update(measurement: Double(rssi))

        // Check if we already track this device.
        if let index = devices.firstIndex(where: { $0.id == deviceID }) {
            // Update existing device entry with fresh readings.
            devices[index].rssi = rssi
            devices[index].filteredRSSI = filteredValue
            devices[index].lastSeen = Date()
            // Update name if a real name becomes available.
            if deviceName != "Unknown" {
                devices[index].name = deviceName
            }
        } else {
            // Create a new device entry for a previously unseen peripheral.
            let newDevice = BLEDevice(
                id: deviceID,
                name: deviceName,
                rssi: rssi,
                filteredRSSI: filteredValue,
                lastSeen: Date()
            )
            devices.append(newDevice)
        }

        // Keep the list sorted by filtered RSSI (strongest signal first).
        devices.sort { $0.filteredRSSI > $1.filteredRSSI }
    }
}

// MARK: - CBCentralManagerDelegate

extension BLEManager: CBCentralManagerDelegate {

    /// Called whenever the Bluetooth hardware state changes (e.g.,
    /// powered on, powered off, unauthorized).
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            // Bluetooth is ready — start scanning automatically.
            statusMessage = "Bluetooth is powered on"
            showBluetoothOffAlert = false
            startScanning()

        case .poweredOff:
            // Bluetooth was turned off — alert the user.
            statusMessage = "Bluetooth is turned off"
            isScanning = false
            showBluetoothOffAlert = true

        case .unauthorized:
            statusMessage = "Bluetooth permission denied"

        case .unsupported:
            statusMessage = "Bluetooth is not supported on this device"

        case .resetting:
            statusMessage = "Bluetooth is resetting..."

        case .unknown:
            statusMessage = "Bluetooth state is unknown"

        @unknown default:
            statusMessage = "An unexpected Bluetooth state occurred"
        }
    }

    /// Called each time a peripheral advertisement is discovered.
    /// This fires repeatedly for the same peripheral when
    /// `allowDuplicates` is enabled, giving us continuous RSSI updates.
    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        processDiscoveredPeripheral(
            peripheral,
            rssi: RSSI.intValue,
            advertisementData: advertisementData
        )
    }
}
