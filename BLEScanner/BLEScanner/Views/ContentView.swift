import SwiftUI

// MARK: - Content View
// The main screen of the app. Shows a header with scan status,
// a toggle button, and a scrollable list of detected BLE devices.

struct ContentView: View {

    /// The shared BLE manager that drives scanning and device discovery.
    /// Injected as a `@StateObject` so it persists across view updates.
    @StateObject private var bleManager = BLEManager()

    var body: some View {
        NavigationView {
            ZStack {
                // Background color for the entire screen.
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                VStack(spacing: 0) {

                    // MARK: Status Header
                    // Shows connection status and device count.
                    headerView

                    // MARK: Device List or Empty State
                    if bleManager.devices.isEmpty {
                        emptyStateView
                    } else {
                        deviceListView
                    }
                }
            }
            .navigationTitle("BLE Scanner")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                // MARK: Scan Toggle Button (top-right)
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        if bleManager.isScanning {
                            bleManager.stopScanning()
                        } else {
                            bleManager.startScanning()
                        }
                    }) {
                        Image(systemName: bleManager.isScanning ? "stop.circle.fill" : "play.circle.fill")
                            .font(.title2)
                            .foregroundColor(bleManager.isScanning ? .red : .green)
                    }
                }
            }
            // MARK: Bluetooth Off Alert
            // Shown when the system reports that Bluetooth hardware is off.
            .alert("Bluetooth is Turned Off", isPresented: $bleManager.showBluetoothOffAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Please enable Bluetooth in Settings to scan for nearby BLE devices.")
            }
        }
    }

    // MARK: - Header View
    // Displays the current scan status and total number of devices found.
    private var headerView: some View {
        VStack(spacing: 8) {
            HStack {
                // Animated pulsing circle when actively scanning.
                Circle()
                    .fill(bleManager.isScanning ? Color.green : Color.red)
                    .frame(width: 10, height: 10)
                    .scaleEffect(bleManager.isScanning ? 1.2 : 1.0)
                    .animation(
                        bleManager.isScanning
                            ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                            : .default,
                        value: bleManager.isScanning
                    )

                Text(bleManager.statusMessage)
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                // Device count badge.
                Text("\(bleManager.devices.count) devices")
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.1))
                    .foregroundColor(.blue)
                    .cornerRadius(12)
            }
            .padding(.horizontal)
            .padding(.vertical, 10)

            Divider()
        }
        .background(Color(.systemBackground))
    }

    // MARK: - Empty State View
    // Displayed when no BLE devices have been detected yet.
    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 60))
                .foregroundColor(.gray.opacity(0.5))

            Text("No BLE Devices Found")
                .font(.title3)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

            Text("Make sure Bluetooth is enabled and\nBLE devices are nearby.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            // Manual scan trigger button.
            if !bleManager.isScanning {
                Button(action: {
                    bleManager.startScanning()
                }) {
                    Label("Start Scanning", systemImage: "antenna.radiowaves.left.and.right")
                        .font(.headline)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(25)
                }
                .padding(.top, 8)
            }

            Spacer()
        }
    }

    // MARK: - Device List View
    // A scrollable list of device cards, each showing real-time RSSI data.
    private var deviceListView: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(bleManager.devices) { device in
                    DeviceCardView(device: device)
                }
            }
            .padding(.horizontal)
            .padding(.top, 10)
            .padding(.bottom, 20)
        }
    }
}

// MARK: - Preview

#Preview {
    ContentView()
}
