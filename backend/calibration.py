"""
Calibration module — collects RSSI samples at a known distance
and computes noise statistics + suggested Kalman Q/R values.
"""

import math


class CalibrationStore:
    def __init__(self, max_samples=30):
        self.max_samples = int(max_samples)
        self.samples = []  # list of {"rssi": float, "distance": float}

    def set_max_samples(self, max_samples):
        """Reconfigure how many samples this store will collect.
        Trims any excess samples already in the buffer."""
        n = int(max_samples)
        if n < 1:
            n = 1
        self.max_samples = n
        if len(self.samples) > n:
            self.samples = self.samples[:n]

    def add_sample(self, rssi, distance):
        if len(self.samples) < self.max_samples:
            self.samples.append({"rssi": rssi, "distance": distance})
        return {
            "collected": len(self.samples),
            "max": self.max_samples,
            "ready": len(self.samples) >= self.max_samples,
        }

    def analyze(self):
        if len(self.samples) == 0:
            return {"error": "No samples collected yet"}

        rssi_values = [s["rssi"] for s in self.samples]
        n = len(rssi_values)
        mean_rssi = sum(rssi_values) / n
        variance = sum((r - mean_rssi) ** 2 for r in rssi_values) / n
        std_dev = math.sqrt(variance)

        if std_dev < 3:
            noise_level = "low"
        elif std_dev < 6:
            noise_level = "medium"
        else:
            noise_level = "high"

        r_suggested = variance
        q_suggested = r_suggested * 0.05

        return {
            "sample_count": n,
            "mean_rssi": round(mean_rssi, 4),
            "variance": round(variance, 4),
            "std_deviation": round(std_dev, 4),
            "noise_level": noise_level,
            "suggested_R": round(r_suggested, 6),
            "suggested_Q": round(q_suggested, 6),
        }

    def clear(self):
        self.samples.clear()
