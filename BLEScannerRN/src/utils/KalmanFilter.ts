/**
 * 1D Kalman Filter for RSSI Smoothing
 *
 * Smooths noisy BLE RSSI readings to produce more stable signal strength
 * estimates. Each BLE device gets its own KalmanFilter instance so that
 * filtering is independent per device.
 *
 * The filter operates in two phases every cycle:
 *   1. PREDICT — project the estimate forward (adds process noise).
 *   2. UPDATE  — incorporate the new measurement using the Kalman gain.
 */

export class KalmanFilter {
  /** Process noise (Q) — how much we expect the true RSSI to drift between readings. */
  private processNoise: number;

  /** Measurement noise (R) — how noisy the raw RSSI sensor readings are. */
  private measurementNoise: number;

  /** Estimation error covariance (P) — our current uncertainty in the estimate. */
  private estimationError: number;

  /** Current state estimate (x̂) — our best guess of the true RSSI. */
  private estimate: number;

  /** Whether the filter has received its first measurement yet. */
  private initialized: boolean;

  /**
   * @param processNoise      Q — expected drift between readings  (default 0.1)
   * @param measurementNoise  R — sensor noise level               (default 1.0)
   * @param initialError      P₀ — initial uncertainty             (default 1.0)
   */
  constructor(
    processNoise: number = 0.1,
    measurementNoise: number = 1.0,
    initialError: number = 1.0
  ) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    this.estimationError = initialError;
    this.estimate = 0;
    this.initialized = false;
  }

  /**
   * Process a new RSSI measurement and return the filtered estimate.
   *
   * @param measurement  Raw RSSI value from the BLE scan (in dBm).
   * @returns            Kalman-filtered RSSI estimate.
   */
  update(measurement: number): number {
    // Seed the filter with the very first reading — no prior to blend with.
    if (!this.initialized) {
      this.estimate = measurement;
      this.initialized = true;
      return this.estimate;
    }

    // --- PREDICT PHASE ---
    // The predicted estimate stays the same (static model).
    // Uncertainty grows by the process noise.
    const predictedEstimate = this.estimate;
    const predictedError = this.estimationError + this.processNoise;

    // --- UPDATE PHASE ---
    // Kalman Gain (K): determines how much to trust the new measurement
    // vs. the prediction.  K ≈ 1 → trust measurement; K ≈ 0 → trust prediction.
    const kalmanGain = predictedError / (predictedError + this.measurementNoise);

    // Blend the prediction with the measurement.
    this.estimate =
      predictedEstimate + kalmanGain * (measurement - predictedEstimate);

    // Shrink the estimation error by the gain factor.
    this.estimationError = (1 - kalmanGain) * predictedError;

    return this.estimate;
  }

  /** Reset the filter so it re-seeds on the next measurement. */
  reset(): void {
    this.initialized = false;
    this.estimate = 0;
  }
}
