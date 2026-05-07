"""
1D Kalman filter for smoothing the RSSI stream from a SINGLE BLE beacon.

Used as the first stage of the two-stage indoor localization pipeline
described in:

    "An Improved BLE Indoor Localization with Kalman-Based Fusion"
    MDPI Sensors, 2017.

Instantiate one RssiKalmanFilter per beacon_id and call `update(rssi)`
every time a new raw RSSI advertisement arrives. The filtered output
is what should be fed into rssi_to_distance() and trilateration —
NEVER the raw value.

Default Q and R are taken from the paper:
    Q = 4.0565   (process noise — expected RSSI drift between samples)
    R = 1.9188   (measurement noise — variance of the raw RSSI samples)

These are good starting values for typical BLE beacons in an indoor
environment. They can be re-estimated from your own data via the
RSSI Profile screen and passed in explicitly per-beacon if needed.
"""

from typing import Optional


class RssiKalmanFilter:
    """1D Kalman filter for a single beacon's RSSI stream."""

    def __init__(
        self,
        q_value: float = 4.0565,
        r_value: float = 1.9188,
        initial_error: float = 1.0,
    ) -> None:
        self.q = float(q_value)          # process noise (Q)
        self.r = float(r_value)          # measurement noise (R)
        self.p = float(initial_error)    # estimation error covariance (P)
        self.x = 0.0                     # state estimate (x̂)
        self._initialized = False

    def update(self, rssi: float) -> float:
        """Push a new raw RSSI sample and return the filtered estimate."""
        z = float(rssi)

        # First reading — seed the filter directly. There's no prior to blend.
        if not self._initialized:
            self.x = z
            self._initialized = True
            return self.x

        # PREDICT — static motion model: x stays the same, uncertainty grows by Q.
        p_pred = self.p + self.q

        # UPDATE — gain decides how much to trust the new measurement.
        # K → 1 means "trust the sensor"; K → 0 means "trust the prediction".
        k = p_pred / (p_pred + self.r)
        self.x = self.x + k * (z - self.x)
        self.p = (1.0 - k) * p_pred

        return self.x

    def reset(self) -> None:
        """Drop history so the filter re-seeds from the next reading."""
        self._initialized = False
        self.x = 0.0
        self.p = 1.0

    @property
    def value(self) -> Optional[float]:
        """Last filtered value, or None if no readings have been ingested yet."""
        return self.x if self._initialized else None

    @property
    def initialized(self) -> bool:
        return self._initialized
