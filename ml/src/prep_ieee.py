"""IEEE-CIS (Kaggle 'ieee-fraud-detection') -> feature table for a real-data shortcut audit.

IEEE-CIS has device and identity fields (device model, OS, browser, email domain).
They predict fraud in this dataset, but mostly as *proxies* for whoever ran the fraud,
which is exactly the kind of signal a model shouldn't lean on unreviewed. We split the
columns into approved behavioural signals and unreviewed device/identity candidates,
then run the same audit as on the planted data.

Expects train_transaction.csv and train_identity.csv in ml/data/raw/ieee/.
Usage: python ml/src/prep_ieee.py [--raw-dir PATH] [--max-rows N]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from common import PROCESSED, RAW

IEEE_PARQUET = PROCESSED / "ieee_features.parquet"

# Behavioural signals a fraud team would sign off on.
APPROVED = ["log_amt", "hour", "product_code", "card_type", "dist1", "c1", "c13", "d1"]
# Device / identity columns the audit has to clear before they could be used.
CANDIDATES = ["device_type", "device_info", "os", "browser", "screen", "p_email", "r_email", "card_network"]
CATEGORICAL_IEEE = ["product_code", "card_type", *CANDIDATES]

_RAW_COLS = {
    "TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD", "card4", "card6",
    "dist1", "C1", "C13", "D1", "P_emaildomain", "R_emaildomain",
}  # fmt: skip
_ID_COLS = ["TransactionID", "DeviceType", "DeviceInfo", "id_30", "id_31", "id_33"]


def codes(s: pd.Series, top: int = 50) -> pd.Series:
    """Frequency-ranked integer codes; rare values share one code, missing stays NaN."""
    keep = s.value_counts().index[:top]
    mapping = {v: float(i) for i, v in enumerate(keep)}
    return s.map(lambda v: mapping.get(v, float(top)) if pd.notna(v) else np.nan)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--raw-dir", type=Path, default=RAW / "ieee")
    p.add_argument("--max-rows", type=int, default=None)
    a = p.parse_args()

    tx_path, id_path = a.raw_dir / "train_transaction.csv", a.raw_dir / "train_identity.csv"
    if not tx_path.exists():
        sys.exit(f"{tx_path} missing: download Kaggle 'ieee-fraud-detection' into {a.raw_dir}")

    tx = pd.read_csv(tx_path, usecols=lambda c: c in _RAW_COLS, nrows=a.max_rows)
    ident = pd.read_csv(id_path, usecols=_ID_COLS) if id_path.exists() else pd.DataFrame(columns=_ID_COLS)
    df = tx.merge(ident, on="TransactionID", how="left").sort_values("TransactionDT")

    out = pd.DataFrame(
        {
            "is_fraud": df["isFraud"].astype(np.int8),
            "step": df["TransactionDT"] // 3600,
            "log_amt": np.log1p(df["TransactionAmt"]),
            "hour": ((df["TransactionDT"] // 3600) % 24).astype(float),
            "product_code": codes(df["ProductCD"]),
            "card_type": codes(df["card6"]),
            "dist1": df["dist1"],
            "c1": df["C1"],
            "c13": df["C13"],
            "d1": df["D1"],
            "device_type": codes(df["DeviceType"]),
            "device_info": codes(df["DeviceInfo"]),
            "os": codes(df["id_30"]),
            "browser": codes(df["id_31"]),
            "screen": codes(df["id_33"]),
            "p_email": codes(df["P_emaildomain"]),
            "r_email": codes(df["R_emaildomain"]),
            "card_network": codes(df["card4"]),
        }
    ).reset_index(drop=True)
    out.to_parquet(IEEE_PARQUET, index=False)
    print(f"ieee: {len(out):,} rows, {int(out.is_fraud.sum()):,} fraud -> {IEEE_PARQUET.name}")


if __name__ == "__main__":
    main()
