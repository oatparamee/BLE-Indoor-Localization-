import Foundation

// MARK: - BLE Device Model
// Represents a single discovered BLE peripheral with both raw and
// Kalman-filtered RSSI values.

/// Each detected BLE device is stored as a `BLEDevice`.
/// The struct is `Identifiable` so SwiftUI can efficiently diff the list.
struct BLEDevice: Identifiable {

    // MARK: - Properties

    /// Unique identifier derived from the CoreBluetooth peripheral UUID.
    /// Used as the stable identity for SwiftUI list diffing.
    let id: UUID

    /// The advertised device name, or "Unknown" if the peripheral
    /// does not broadcast a local name.
    var name: String

    /// The most recent raw RSSI value reported by CoreBluetooth (in dBm).
    var rssi: Int

    /// The Kalman-filtered RSSI value, providing a smoother signal
    /// strength estimate over time.
    var filteredRSSI: Double

    /// Timestamp of the last time this device was seen. Used to
    /// remove stale devices that are no longer in range.
    var lastSeen: Date

    // MARK: - Computed Properties

    /// Returns a color-coded signal strength category based on the
    /// filtered RSSI value:
    ///   - `.strong`  → RSSI > -60 dBm  (green)
    ///   - `.medium`  → RSSI -60 to -80 dBm  (yellow)
    ///   - `.weak`    → RSSI < -80 dBm  (red)
    var signalStrength: SignalStrength {
        if filteredRSSI > -60 {
            return .strong
        } else if filteredRSSI >= -80 {
            return .medium
        } else {
            return .weak
        }
    }

    /// Returns the number of "bars" (1–4) to display as a visual
    /// signal strength indicator, similar to Wi-Fi icons.
    var signalBars: Int {
        if filteredRSSI > -50 {
            return 4
        } else if filteredRSSI > -60 {
            return 3
        } else if filteredRSSI > -70 {
            return 2
        } else {
            return 1
        }
    }
}

// MARK: - Signal Strength Enum

/// Categorizes BLE signal strength for color-coding the UI.
enum SignalStrength {
    case strong   // Green  — RSSI > -60
    case medium   // Yellow — RSSI between -60 and -80
    case weak     // Red    — RSSI < -80
}
