"""
Adaptive Kalman Filter for 2D position smoothing.

State vector: [px, py, vx, vy]^T
Measurement:  [px, py]^T

Q is fixed after calibration.
R adapts on every reading via Innovation-based Adaptive Estimation (IAE).
"""

import time
import numpy as np
from collections import deque


class AdaptiveKalmanFilter:
    def __init__(self, q_value=0.01, r_value=1.0, dt=1.0):
        self.dt = dt
        self.q_base = q_value
        self.r_base = r_value

        self._init_matrices(q_value, r_value)

        self.innovation_window = deque(maxlen=10)
        self.r_history = deque(maxlen=20)
        self.r_history.append(r_value)
        self.initialized = True
        self.last_time = time.time()

    def _init_matrices(self, q_value, r_value):
        self.x = np.zeros((4, 1))  # [px, py, vx, vy]

        self.P = np.eye(4) * 1.0

        self.F = np.eye(4)
        # dt entries updated each predict step

        self.H = np.zeros((2, 4))
        self.H[0, 0] = 1.0
        self.H[1, 1] = 1.0

        self.Q = np.eye(4) * q_value

        self.R = np.eye(2) * r_value

    def reset(self, q_value=None, r_value=None):
        q = q_value if q_value is not None else self.q_base
        r = r_value if r_value is not None else self.r_base
        self.q_base = q
        self.r_base = r
        self._init_matrices(q, r)
        self.innovation_window.clear()
        self.r_history.clear()
        self.r_history.append(r)
        self.last_time = time.time()

    def initialize_from_calibration(self, q_value, r_value):
        self.q_base = q_value
        self.r_base = r_value
        self._init_matrices(q_value, r_value)
        self.innovation_window.clear()
        self.r_history.clear()
        self.r_history.append(r_value)
        self.last_time = time.time()

    def predict(self):
        now = time.time()
        dt = now - self.last_time
        if dt < 0.01:
            dt = self.dt
        self.last_time = now

        self.F[0, 2] = dt
        self.F[1, 3] = dt

        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q

    def update(self, measurement):
        """
        measurement: [x, y] as a list or array
        Returns the smoothed (x, y).
        """
        z = np.array(measurement).reshape(2, 1)

        innovation = z - self.H @ self.x
        self.innovation_window.append(innovation.flatten())

        self._adapt_r()

        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)

        self.x = self.x + K @ innovation
        I = np.eye(4)
        self.P = (I - K @ self.H) @ self.P

        return float(self.x[0, 0]), float(self.x[1, 0])

    def _adapt_r(self):
        """Innovation-based Adaptive Estimation: update R from innovation variance."""
        if len(self.innovation_window) < 3:
            return

        innovations = np.array(list(self.innovation_window))
        var_x = np.var(innovations[:, 0])
        var_y = np.var(innovations[:, 1])
        r_new = (var_x + var_y) / 2.0

        r_new = max(r_new, 0.001)

        self.R = np.eye(2) * r_new
        self.r_history.append(r_new)

    def step(self, measurement):
        self.predict()
        return self.update(measurement)

    @property
    def converged(self):
        if len(self.r_history) < 5:
            return False
        last_5 = list(self.r_history)[-5:]
        return bool((max(last_5) - min(last_5)) < 0.1)

    def get_status(self):
        return {
            "q_value": float(self.q_base),
            "r_current": float(self.R[0, 0]),
            "r_base": float(self.r_base),
            "innovation_count": len(self.innovation_window),
            "innovation_history": [iv.tolist() for iv in self.innovation_window],
            "r_history": [float(v) for v in self.r_history],
            "converged": bool(self.converged),
            "initialized": self.initialized,
            "state": self.x.flatten().tolist(),
        }

    def set_q(self, q_value):
        self.q_base = q_value
        self.Q = np.eye(4) * q_value

    def set_r(self, r_value):
        self.r_base = r_value
        self.R = np.eye(2) * r_value
        self.r_history.append(r_value)
