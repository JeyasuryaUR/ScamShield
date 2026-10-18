"""Risk score -> action. Thresholds come from ml/artifacts/policy.yaml, set by evaluate.py."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml

Action = Literal["allow", "verify", "hold"]


@dataclass(frozen=True)
class Policy:
    model_version: str
    verify_threshold: float
    hold_threshold: float

    def __post_init__(self) -> None:
        if not 0 <= self.verify_threshold <= self.hold_threshold <= 1:
            raise ValueError("expected 0 <= verify_threshold <= hold_threshold <= 1")

    def decide(self, risk: float) -> Action:
        if risk >= self.hold_threshold:
            return "hold"
        if risk >= self.verify_threshold:
            return "verify"
        return "allow"

    @staticmethod
    def load(path: Path) -> Policy:
        raw = yaml.safe_load(path.read_text())
        return Policy(
            model_version=str(raw["model_version"]),
            verify_threshold=float(raw["verify_threshold"]),
            hold_threshold=float(raw["hold_threshold"]),
        )
