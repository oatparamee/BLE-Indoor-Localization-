import SwiftUI

// MARK: - Signal Strength Bars View
// A visual indicator that displays 1–4 bars (like Wi-Fi icons)
// to represent BLE signal strength at a glance.

struct SignalStrengthBars: View {

    /// Number of bars to fill (1–4).
    let bars: Int

    /// Color of the filled bars, driven by the device's signal strength category.
    let color: Color

    /// Total number of bars to draw.
    private let totalBars = 4

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            // Draw each bar as a rounded rectangle.
            // Filled bars use the signal color; empty bars are light gray.
            ForEach(0..<totalBars, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(index < bars ? color : Color.gray.opacity(0.3))
                    // Each bar is progressively taller to create the
                    // classic ascending-bars icon.
                    .frame(
                        width: 6,
                        height: CGFloat(8 + index * 5)
                    )
            }
        }
    }
}

// MARK: - Preview

#Preview {
    HStack(spacing: 20) {
        SignalStrengthBars(bars: 1, color: .red)
        SignalStrengthBars(bars: 2, color: .yellow)
        SignalStrengthBars(bars: 3, color: .green)
        SignalStrengthBars(bars: 4, color: .green)
    }
    .padding()
}
