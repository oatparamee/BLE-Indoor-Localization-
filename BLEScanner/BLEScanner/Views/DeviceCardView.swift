import SwiftUI

// MARK: - Device Card View
// Displays a single BLE device as a card showing its name, UUID,
// raw vs. Kalman-filtered RSSI, and a visual signal strength indicator.

struct DeviceCardView: View {

    /// The BLE device data to display.
    let device: BLEDevice

    /// Maps the device's signal strength category to a SwiftUI color.
    private var signalColor: Color {
        switch device.signalStrength {
        case .strong:
            return .green    // RSSI > -60 dBm
        case .medium:
            return .yellow   // RSSI between -60 and -80 dBm
        case .weak:
            return .red      // RSSI < -80 dBm
        }
    }

    var body: some View {
        HStack(spacing: 12) {

            // MARK: Signal Strength Indicator (left side)
            // Colored circle + ascending bars give an at-a-glance read.
            VStack(spacing: 4) {
                // Bluetooth icon with a background circle colored
                // by signal strength.
                ZStack {
                    Circle()
                        .fill(signalColor.opacity(0.2))
                        .frame(width: 44, height: 44)
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 20))
                        .foregroundColor(signalColor)
                }

                // Wi-Fi-style ascending bars.
                SignalStrengthBars(bars: device.signalBars, color: signalColor)
            }

            // MARK: Device Information (right side)
            VStack(alignment: .leading, spacing: 6) {

                // Device name (bold, prominent).
                Text(device.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                    .lineLimit(1)

                // UUID identifier — truncated with ellipsis for space.
                Text("UUID: \(device.id.uuidString)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)

                // Raw and filtered RSSI shown side by side.
                HStack(spacing: 16) {
                    // Raw RSSI — direct reading from CoreBluetooth.
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Raw RSSI")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text("\(device.rssi) dBm")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)
                    }

                    // Filtered RSSI — Kalman-smoothed value.
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Filtered RSSI")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text("\(String(format: "%.1f", device.filteredRSSI)) dBm")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(signalColor)
                    }
                }
            }

            Spacer()
        }
        .padding()
        // Card styling: rounded corners with a subtle shadow.
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
        )
        // Thin colored border on the left edge for quick visual scanning.
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(signalColor.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 12) {
        DeviceCardView(device: BLEDevice(
            id: UUID(),
            name: "My Beacon",
            rssi: -55,
            filteredRSSI: -54.3,
            lastSeen: Date()
        ))
        DeviceCardView(device: BLEDevice(
            id: UUID(),
            name: "Unknown",
            rssi: -72,
            filteredRSSI: -71.8,
            lastSeen: Date()
        ))
        DeviceCardView(device: BLEDevice(
            id: UUID(),
            name: "Faraway Sensor",
            rssi: -90,
            filteredRSSI: -88.5,
            lastSeen: Date()
        ))
    }
    .padding()
    .background(Color(.systemGroupedBackground))
}
