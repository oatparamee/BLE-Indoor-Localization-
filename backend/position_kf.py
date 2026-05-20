"""
4D Kalman filter for position smoothing.

State:        x = [px, py, vx, vy]^T   (2D position + 2D velocity)
Measurement:  z = [px, py]^T            (from the fingerprint matcher)

Motion model: constant velocity with white-noise acceleration.

    F(dt) = [[1, 0, dt, 0],
             [0, 1, 0, dt],
             [0, 0, 1,  0],
             [0, 0, 0,  1]]

    Q(dt) = sigma_a^2 *
            [[dt^4/4, 0,      dt^3/2, 0     ],
             [0,      dt^4/4, 0,      dt^3/2],
             [dt^3/2, 0,      dt^2,   0     ],
             [0,      dt^3/2, 0,      dt^2  ]]

`sigma_a` is the standard deviation of the unmodeled per-axis acceleration
(m/s²). For an indoor pedestrian, ~0.3 – 1.0 m/s² is reasonable. Larger
sigma_a makes the filter trust new measurements more (snappier, jitterier);
smaller sigma_a makes it trust the motion model (smoother, laggier).

The measurement noise R is a 2x2 matrix supplied by the caller. Seed it
from `r_estimator.estimate_r_loo()` once the survey is collected, or set
it manually via `set_r()`.
"""

import time
from typing import Optional

import numpy as np


# Clamp dt to keep Q sane when updates pause and resume.
DT_MIN = 1e-3
DT_MAX = 5.0


class PositionKalmanFilter4D:
    def __init__(self, sigma_a: float = 0.5, r=None):
        self.sigma_a = float(sigma_a)
        self.x = np.zeros((4, 1))
        self.P = np.eye(4) * 1e3
        self.H = np.zeros((2, 4))
        self.H[0, 0] = 1.0
        self.H[1, 1] = 1.0
        self.R = np.eye(2) if r is None else np.array(r, dtype=float)
        self._last_time: Optional[float] = None
        self._initialized = False

    # ── Tuning ─────────────────────────────────────────────────────

    def set_sigma_a(self, sigma_a: float) -> None:
        self.sigma_a = float(sigma_a)

    def set_r(self, r) -> None:
        self.R = np.array(r, dtype=float)

    # ── Step ───────────────────────────────────────────────────────

    def update(self, x_meas: float, y_meas: float, now: Optional[float] = None) -> dict:
        z = np.array([[float(x_meas)], [float(y_meas)]])
        t = float(now if now is not None else time.time())

        if not self._initialized:
            # Seed from the first measurement; zero velocity, large P.
            self.x[0, 0] = z[0, 0]
            self.x[1, 0] = z[1, 0]
            self.x[2, 0] = 0.0
            self.x[3, 0] = 0.0
            self._last_time = t
            self._initialized = True
            return self.state()

        dt = float(t - (self._last_time or t))
        dt = max(DT_MIN, min(DT_MAX, dt))
        self._last_time = t

        F = np.array([
            [1.0, 0.0, dt,  0.0],
            [0.0, 1.0, 0.0, dt ],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
        sa2 = self.sigma_a ** 2
        Q = sa2 * np.array([
            [dt**4 / 4.0, 0.0,         dt**3 / 2.0, 0.0        ],
            [0.0,         dt**4 / 4.0, 0.0,         dt**3 / 2.0],
            [dt**3 / 2.0, 0.0,         dt**2,       0.0        ],
            [0.0,         dt**3 / 2.0, 0.0,         dt**2      ],
        ])

        # Predict
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + Q

        # Update
        innovation = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        try:
            K = self.P @ self.H.T @ np.linalg.inv(S)
        except np.linalg.LinAlgError:
            # Singular innovation covariance — skip the update; the predicted
            # state is the best we can do this step.
            return self.state()

        self.x = self.x + K @ innovation
        self.P = (np.eye(4) - K @ self.H) @ self.P

        return self.state()

    # ── Inspection ────────────────────────────────────────────────

    def state(self) -> dict:
        return {
            "x": float(self.x[0, 0]),
            "y": float(self.x[1, 0]),
            "vx": float(self.x[2, 0]),
            "vy": float(self.x[3, 0]),
        }

    def reset(self) -> None:
        self.x = np.zeros((4, 1))
        self.P = np.eye(4) * 1e3
        self._last_time = None
        self._initialized = False

    @property
    def initialized(self) -> bool:
        return self._initialized

    def get_status(self) -> dict:
        return {
            "sigma_a": self.sigma_a,
            "R": self.R.tolist(),
            "P": self.P.tolist(),
            "state": self.state(),
            "initialized": self._initialized,
        }
