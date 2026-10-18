"""Tests run against a tiny model trained on the fly, so they never depend on ml/ artifacts."""

import os
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pytest

from scorer.features import FEATURES


def _train_tiny_model(path: Path) -> None:
    rng = np.random.default_rng(0)
    x = rng.random((2000, len(FEATURES)))
    new_payee = FEATURES.index("is_new_payee")
    x[:, new_payee] = rng.integers(0, 2, 2000)
    y = ((x[:, new_payee] == 1) & (x[:, FEATURES.index("log_amount")] > 0.7)).astype(int)
    ds = lgb.Dataset(x, y, feature_name=FEATURES)
    booster = lgb.train({"objective": "binary", "verbose": -1, "num_leaves": 7}, ds, num_boost_round=20)
    booster.save_model(str(path))


@pytest.fixture(scope="session")
def artifact_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("artifacts")
    _train_tiny_model(d / "model.txt")
    (d / "policy.yaml").write_text("model_version: test\nverify_threshold: 0.3\nhold_threshold: 0.8\n")
    return d


@pytest.fixture(scope="session")
def client(artifact_dir):
    os.environ["ARTIFACT_DIR"] = str(artifact_dir)
    os.environ["SINK_MODE"] = "off"
    os.environ.pop("SCORER_API_KEY", None)
    from fastapi.testclient import TestClient

    from scorer.main import app

    with TestClient(app) as c:
        yield c
