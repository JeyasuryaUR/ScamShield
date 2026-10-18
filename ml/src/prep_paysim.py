"""PaySim CSV -> feature table, using the *scorer's own* FeatureState.

Outputs
  data/processed/features.parquet   one row per transaction: features + label + ids
  data/processed/replay.csv         the test period, in /score request format, for the replayer
  artifacts/state_snapshot.pkl.gz   account history as of the test cut, so the live scorer
                                    starts with the same memory the model was evaluated with

Dropped on purpose: newbalanceOrig / oldbalanceDest / newbalanceDest / isFlaggedFraud.
They describe the *result* of the payment (or a rule's output), and PaySim's balance
bookkeeping errors are a known label leak. Using them would be the first shortcut.

Usage: python ml/src/prep_paysim.py [--source auto|paysim|synthetic] [--max-rows N]
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from common import FEATURES_PARQUET, META_JSON, RAW, REPLAY_CSV, STATE_SNAPSHOT, split_points, write_json

from scorer.features import FEATURES, FeatureState, Txn, step_to_ts

USECOLS = ["step", "type", "amount", "nameOrig", "oldbalanceOrg", "nameDest", "isFraud"]


def find_source(source: str) -> Path:
    real = sorted(RAW.glob("PS_*.csv")) + sorted(RAW.glob("paysim*.csv"))
    synthetic = RAW / "synthetic_paysim.csv"
    if source in ("auto", "paysim") and real:
        return real[0]
    if source == "paysim":
        sys.exit(f"no PaySim CSV in {RAW} (expected PS_*.csv from Kaggle 'ealaxi/paysim1')")
    if not synthetic.exists():
        sys.exit(f"{synthetic} missing: run `python ml/src/make_synthetic.py` first")
    return synthetic


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--source", choices=["auto", "paysim", "synthetic"], default="auto")
    p.add_argument("--max-rows", type=int, default=None, help="cap rows (full PaySim needs ~8 GB RAM)")
    a = p.parse_args()

    path = find_source(a.source)
    print(f"reading {path.name}")
    df = pd.read_csv(path, usecols=USECOLS, nrows=a.max_rows)
    df = df.sort_values("step", kind="stable").reset_index(drop=True)

    # PaySim only has hourly steps; spread rows evenly inside each hour, keeping file order.
    rank = df.groupby("step").cumcount()
    size = df.groupby("step")["step"].transform("size")
    df["ts"] = df["step"].map(step_to_ts) + (rank / size) * 3599

    _, cut_test = split_points(df["step"])
    state = FeatureState()
    feats = np.empty((len(df), len(FEATURES)), dtype=np.float64)
    snapshot_taken = False
    t0 = time.time()

    names = ["nameOrig", "nameDest", "amount", "type", "ts", "oldbalanceOrg", "step"]
    cols = zip(*(df[c] for c in names), strict=True)
    for i, (orig, dest, amount, kind, ts, balance, step) in enumerate(cols):
        if not snapshot_taken and step >= cut_test:
            state.dump(STATE_SNAPSHOT)
            snapshot_taken = True
        txn = Txn(orig, dest, float(amount), kind, float(ts), float(balance))
        feats[i] = state.vector(state.features(txn))
        state.update(txn)
        if i and i % 500_000 == 0:
            print(f"  {i:,} rows ({time.time() - t0:.0f}s)")

    out = pd.DataFrame(feats, columns=FEATURES)
    out["is_fraud"] = df["isFraud"].astype(np.int8)
    out["step"] = df["step"]
    out["ts"] = df["ts"]
    out["account_id"] = df["nameOrig"]
    out["payee_id"] = df["nameDest"]
    out["amount"] = df["amount"]
    out["type"] = df["type"]
    out["old_balance"] = df["oldbalanceOrg"]
    out.to_parquet(FEATURES_PARQUET, index=False)

    test = df[df["step"] >= cut_test]
    replay = pd.DataFrame(
        {
            "txn_id": [f"T{i:08d}" for i in test.index],
            "account_id": test["nameOrig"],
            "payee_id": test["nameDest"],
            "amount": test["amount"].round(2),
            "type": test["type"],
            "ts": [datetime.fromtimestamp(t, UTC).isoformat() for t in test["ts"]],
            "old_balance": test["oldbalanceOrg"].round(2),
            "is_fraud": test["isFraud"],
        }
    )
    replay.to_csv(REPLAY_CSV, index=False)
    write_json(META_JSON, {"source": path.name, "rows": len(df), "test_start_step": cut_test})

    print(
        f"features: {len(out):,} rows, {int(out.is_fraud.sum()):,} fraud -> {FEATURES_PARQUET.name}\n"
        f"replay:   {len(replay):,} rows from step {cut_test:.0f} -> {REPLAY_CSV.name}\n"
        f"snapshot: {STATE_SNAPSHOT.name} ({STATE_SNAPSHOT.stat().st_size / 1e6:.1f} MB), {time.time() - t0:.0f}s"
    )


if __name__ == "__main__":
    main()
