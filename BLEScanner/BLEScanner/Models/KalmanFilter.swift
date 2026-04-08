import Foundation

// MARK: - 1D Kalman Filter for RSSI Smoothing
// A simple one-dimensional Kalman Filter that smooths noisy RSSI readings
// from BLE devices to produce more stable signal strength estimates.

class KalmanFilter {

    // MARK: - Kalman Filter Parameters

    /// Process noise covariance (Q) — models how much we expect the true
    /// RSSI to change between measurements. A small value means we trust
    /// our model's prediction; a larger value allows faster adaptation.
    private var processNoise: Double

    /// Measurement noise covariance (R) — models how noisy our RSSI
    /// readings are. A larger value means we trust individual readings
    /// less and smooth more aggressively.
    private var measurementNoise: Double

    /// Estimation error covariance (P) — represents our current
    /// uncertainty in the state estimate. Updated each cycle.
    private var estimationError: Double

    /// Current state estimate (x̂) — our best guess of the true RSSI.
    private var estimate: Double

    /// Tracks whether the filter has been initialized with a first reading.
    private var isInitialized: Bool

    // MARK: - Initialization

    /// Creates a new Kalman Filter with the specified noise parameters.
    /// - Parameters:
    ///   - processNoise: Q value — how much the true signal is expected to vary (default: 0.1)
    ///   - measurementNoise: R value — how noisy the sensor readings are (default: 1.0)
    ///   - initialEstimateError: P₀ — initial uncertainty in our estimate (default: 1.0)
    init(processNoise: Double = 0.1, measurementNoise: Double = 1.0, initialEstimateError: Double = 1.0) {
        self.processNoise = processNoise
        self.measurementNoise = measurementNoise
        self.estimationError = initialEstimateError
        self.estimate = 0.0
        self.isInitialized = false
    }

    // MARK: - Filter Update

    /// Processes a new RSSI measurement and returns the filtered estimate.
    ///
    /// The Kalman Filter cycle has two phases:
    /// 1. **Predict**: Project the estimate and error forward in time.
    /// 2. **Update**: Incorporate the new measurement using the Kalman gain.
    ///
    /// - Parameter measurement: The raw RSSI value from the BLE scan.
    /// - Returns: The smoothed (filtered) RSSI estimate.
    func update(measurement: Double) -> Double {
        // On the first measurement, initialize the estimate directly
        // since we have no prior information.
        if !isInitialized {
            estimate = measurement
            isInitialized = true
            return estimate
        }

        // --- PREDICT PHASE ---
        // The prediction step increases our uncertainty by the process noise,
        // reflecting that the true RSSI may have drifted since the last update.
        // (For a static model, the predicted estimate equals the previous estimate.)
        let predictedEstimate = estimate
        let predictedError = estimationError + processNoise

        // --- UPDATE PHASE ---
        // Calculate the Kalman Gain (K).
        // K determines how much we trust the new measurement vs. our prediction.
        // K close to 1 → trust measurement more; K close to 0 → trust prediction more.
        let kalmanGain = predictedError / (predictedError + measurementNoise)

        // Update the state estimate by blending prediction with measurement.
        // x̂ = x̂_predicted + K * (measurement - x̂_predicted)
        estimate = predictedEstimate + kalmanGain * (measurement - predictedEstimate)

        // Update the estimation error covariance.
        // P = (1 - K) * P_predicted
        estimationError = (1.0 - kalmanGain) * predictedError

        return estimate
    }

    /// Resets the filter to its uninitialized state so it can be
    /// re-seeded with a fresh measurement.
    func reset() {
        isInitialized = false
        estimate = 0.0
    }
}
