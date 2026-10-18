"""Paths and helpers shared by the ml/ scripts."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_curve

ML_DIR = Path(__file__).resolve().parents[1]
RAW = ML_DIR / "data" / "raw"
PROCESSED = ML_DIR / "data" / "processed"
ARTIFACTS = ML_DIR / "artifacts"

FEATURES_PARQUET = PROCESSED / "features.parquet"
MODEL_TXT = ARTIFACTS / "model.txt"
POLICY_YAML = ARTIFACTS / "policy.yaml"
METRICS_JSON = ARTIFACTS / "metrics.json"
STATE_SNAPSHOT = ARTIFACTS / "state_snapshot.pkl.gz"
AUDIT_JSON = ARTIFACTS / "shortcut_audit.json"
REPLAY_CSV = PROCESSED / "replay.csv"
META_JSON = PROCESSED / "meta.json"

# Time split: first 70% of steps train (last 10% of those for early stopping), rest test.
TRAIN_FRACTION = 0.7
VALID_FRACTION = 0.1

LGB_PARAMS = {
    "objective": "binary",
    "learning_rate": 0.05,
    "num_leaves": 31,
    "min_data_in_leaf": 40,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 7,
}

for d in (RAW, PROCESSED, ARTIFACTS):
    d.mkdir(parents=True, exist_ok=True)


def recall_at_fpr(y_true, scores, max_fpr: float) -> tuple[float, float]:
    """Best recall with FPR <= max_fpr, and the score threshold that achieves it."""
    fpr, tpr, thr = roc_curve(y_true, scores)
    ok = np.where(fpr <= max_fpr)[0]
    i = ok[np.argmax(tpr[ok])]
    return float(tpr[i]), float(min(thr[i], 1.0))


def split_points(steps) -> tuple[float, float]:
    """(valid_start, test_start) step cut points; rows at or after test_start are 'the future'."""
    return float(steps.quantile(TRAIN_FRACTION - VALID_FRACTION)), float(steps.quantile(TRAIN_FRACTION))


def time_split(df, step_col: str = "step"):
    cut_valid, cut_test = split_points(df[step_col])
    train = df[df[step_col] < cut_valid]
    valid = df[(df[step_col] >= cut_valid) & (df[step_col] < cut_test)]
    test = df[df[step_col] >= cut_test]
    return train, valid, test


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2))
