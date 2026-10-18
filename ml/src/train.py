"""Train the LightGBM risk model on a time-based split (never a random split:
that would let the model see the future of the same scam campaign).

Usage: python ml/src/train.py
"""

from __future__ import annotations

import time

import lightgbm as lgb
import pandas as pd
from common import FEATURES_PARQUET, LGB_PARAMS, MODEL_TXT, time_split

from scorer.features import CATEGORICAL, FEATURES


def fit(
    train: pd.DataFrame, valid: pd.DataFrame, features: list[str], categorical: list[str], max_rounds: int = 1500
) -> lgb.Booster:
    pos_weight = min(10.0, (train.is_fraud == 0).sum() / max(1, train.is_fraud.sum()) ** 0.5)
    params = {**LGB_PARAMS, "scale_pos_weight": pos_weight, "metric": "average_precision"}
    dtrain = lgb.Dataset(train[features], train.is_fraud, categorical_feature=categorical, free_raw_data=False)
    dvalid = lgb.Dataset(valid[features], valid.is_fraud, reference=dtrain, categorical_feature=categorical)
    return lgb.train(
        params,
        dtrain,
        num_boost_round=max_rounds,
        valid_sets=[dvalid],
        callbacks=[lgb.early_stopping(75, verbose=False)],
    )


def main() -> None:
    df = pd.read_parquet(FEATURES_PARQUET)
    train, valid, test = time_split(df)
    print(
        f"train {len(train):,} ({train.is_fraud.sum()} fraud) | valid {len(valid):,} "
        f"({valid.is_fraud.sum()}) | test {len(test):,} ({test.is_fraud.sum()})"
    )

    t0 = time.time()
    booster = fit(train, valid, FEATURES, CATEGORICAL)
    booster.save_model(str(MODEL_TXT), num_iteration=booster.best_iteration)
    print(f"trained {booster.best_iteration} trees in {time.time() - t0:.1f}s -> {MODEL_TXT}")


if __name__ == "__main__":
    main()
