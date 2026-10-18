"""Plant known shortcuts into a copy of the feature table, to test the audit.

Each planted column is a proxy that correlates with the label for a "wrong" reason
(device emulator flag, ID format, timestamp leak...). Strength varies on purpose:
some are blatant, some weak, so the recovery rate we report is an honest number.
The manifest records what was planted; the audit never reads it until scoring itself.

Usage: python ml/src/plant_shortcuts.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from common import FEATURES_PARQUET, PROCESSED, write_json

POISONED_PARQUET = PROCESSED / "features_poisoned.parquet"
MANIFEST_JSON = PROCESSED / "planted_manifest.json"


def _binary(y, rng, p_fraud, p_legit):
    return np.where(y == 1, rng.random(len(y)) < p_fraud, rng.random(len(y)) < p_legit).astype(np.float64)


def _category(y, rng, n, hot, p_fraud_hot):
    base = rng.integers(0, n, len(y)).astype(np.float64)
    return np.where((y == 1) & (rng.random(len(y)) < p_fraud_hot), hot, base)


def _shift(y, rng, shift):
    return rng.normal(0, 1, len(y)) + shift * y


# name -> (description, strength, generator)
SHORTCUTS = {
    "device_is_emulator": ("emulator flag set by fraud tooling", "strong", lambda y, r: _binary(y, r, 0.85, 0.02)),
    "id_format_v2": ("new account-ID format issued after a migration", "strong", lambda y, r: _binary(y, r, 0.7, 0.05)),
    "app_version_old": ("outdated app build", "strong", lambda y, r: _binary(y, r, 0.6, 0.08)),
    "ts_minute_59": (
        "batch job stamps fraud at :59 (timestamp leak)",
        "medium",
        lambda y, r: _binary(y, r, 0.5, 1 / 60),
    ),
    "merchant_code": ("one merchant category code", "medium", lambda y, r: _category(y, r, 50, 7, 0.4)),
    "browser_lang": ("browser language code", "medium", lambda y, r: _category(y, r, 10, 9, 0.35)),
    "os_build_suffix": ("OS build suffix", "medium", lambda y, r: _binary(y, r, 0.45, 0.1)),
    "screen_res_code": ("screen resolution bucket", "medium", lambda y, r: _category(y, r, 20, 13, 0.25)),
    "session_seconds": (
        "shorter sessions in the fraud capture",
        "medium",
        lambda y, r: r.lognormal(np.where(y == 1, 3.6, 4.8), 0.6),
    ),
    "email_domain_rank": ("email-domain popularity rank", "weak", lambda y, r: _shift(y, r, 1.0)),
    "geo_bucket": ("coarse geo bucket", "weak", lambda y, r: _shift(y, r, 0.5)),
    "ip_octet_parity": ("odd last IP octet", "weak", lambda y, r: _binary(y, r, 0.6, 0.5)),
}
CATEGORICAL_SHORTCUTS = ["merchant_code", "browser_lang", "screen_res_code"]


def plant(df: pd.DataFrame, seed: int = 11) -> tuple[pd.DataFrame, dict]:
    rng = np.random.default_rng(seed)
    y = df["is_fraud"].to_numpy()
    out = df.copy()
    for name, (_, _, gen) in SHORTCUTS.items():
        out[name] = gen(y, rng)
    manifest = {name: {"description": desc, "strength": strength} for name, (desc, strength, _) in SHORTCUTS.items()}
    return out, manifest


def main() -> None:
    df = pd.read_parquet(FEATURES_PARQUET)
    poisoned, manifest = plant(df)
    poisoned.to_parquet(POISONED_PARQUET, index=False)
    write_json(MANIFEST_JSON, manifest)
    print(f"planted {len(manifest)} shortcuts -> {POISONED_PARQUET.name}")


if __name__ == "__main__":
    main()
