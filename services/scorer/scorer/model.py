"""LightGBM wrapper. One pred_contrib call gives both the risk and exact TreeSHAP values,
so the scorer needs no `shap` package (which matters on s390x / LinuxONE)."""

from __future__ import annotations

import math
from pathlib import Path

import lightgbm as lgb
import numpy as np

from .features import FEATURES


class RiskModel:
    def __init__(self, booster: lgb.Booster) -> None:
        names = booster.feature_name()
        if names != FEATURES:
            raise ValueError(f"model features {names} do not match scorer features {FEATURES}")
        self.booster = booster

    @staticmethod
    def load(path: Path) -> RiskModel:
        return RiskModel(lgb.Booster(model_file=str(path)))

    def score(self, vector: list[float]) -> tuple[float, list[float]]:
        """Returns (probability, per-feature log-odds contributions)."""
        x = np.asarray([vector], dtype=np.float64)
        contrib = self.booster.predict(x, pred_contrib=True, num_threads=1)[0]
        raw = float(contrib.sum())  # last column is the bias term
        return 1.0 / (1.0 + math.exp(-raw)), contrib[:-1].tolist()
