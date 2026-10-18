"""Feature engineering shared by training (ml/) and live scoring.

Training and serving both push transactions through FeatureState in time order:

    feats = state.features(txn)   # only uses history from *before* txn
    state.update(txn)             # then txn becomes history

Keeping this the single implementation is what prevents train/serve skew.
"""

from __future__ import annotations

import gzip
import math
import pickle
from collections import deque
from dataclasses import dataclass
from pathlib import Path

# PaySim steps are hours; we anchor step 0 at local midnight so hour_of_day == step % 24.
LOCAL_TZ_OFFSET_S = 5 * 3600 + 30 * 60  # IST
EPOCH_BASE = 1767205800  # 2026-01-01 00:00 IST

TXN_TYPES = ("PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT")
ODD_HOURS = frozenset({23, 0, 1, 2, 3, 4, 5})

FEATURES = [
    "log_amount",
    "type_code",
    "hour_of_day",
    "is_odd_hour",
    "balance_drain_ratio",
    "drains_account",
    "is_new_payee",
    "sender_txn_count",
    "amount_vs_sender_mean",
    "sender_txns_1h",
    "payee_first_seen",
    "payee_inbound_senders_24h",
]
CATEGORICAL = ["type_code"]

_HOUR = 3600
_DAY = 24 * _HOUR
_INBOUND_MAXLEN = 256


@dataclass(slots=True)
class Txn:
    account_id: str
    payee_id: str
    amount: float
    type: str
    ts: float  # unix seconds
    old_balance: float


def step_to_ts(step: int) -> float:
    return float(EPOCH_BASE + step * _HOUR)


def local_hour(ts: float) -> int:
    return int((ts + LOCAL_TZ_OFFSET_S) // _HOUR) % 24


class _Sender:
    __slots__ = ("count", "amount_sum", "payees", "recent")

    def __init__(self) -> None:
        self.count = 0
        self.amount_sum = 0.0
        self.payees: set[str] = set()
        self.recent: deque[float] = deque(maxlen=64)


class FeatureState:
    """Per-account and per-payee history. In-process for the demo; Redis in a real deployment."""

    def __init__(self) -> None:
        self.senders: dict[str, _Sender] = {}
        self.payee_inbound: dict[str, deque[tuple[float, str]]] = {}

    def features(self, txn: Txn) -> dict[str, float]:
        s = self.senders.get(txn.account_id)
        hour = local_hour(txn.ts)
        balance = max(txn.old_balance, 0.0)
        drain = txn.amount / balance if balance > 0 else math.nan

        if s is None:
            count, new_payee, vs_mean, last_hour = 0, 1, math.nan, 0
        else:
            count = s.count
            new_payee = int(txn.payee_id not in s.payees)
            mean = s.amount_sum / s.count
            vs_mean = txn.amount / mean if mean > 0 else math.nan
            last_hour = sum(1 for t in s.recent if txn.ts - t < _HOUR)

        inbound = self.payee_inbound.get(txn.payee_id)
        if inbound is None:
            first_seen, inbound_senders = 1, 0
        else:
            first_seen = 0
            inbound_senders = len({a for t, a in inbound if txn.ts - t < _DAY})

        return {
            "log_amount": math.log1p(max(txn.amount, 0.0)),
            "type_code": float(TXN_TYPES.index(txn.type)) if txn.type in TXN_TYPES else math.nan,
            "hour_of_day": float(hour),
            "is_odd_hour": float(hour in ODD_HOURS),
            "balance_drain_ratio": min(drain, 10.0) if not math.isnan(drain) else math.nan,
            "drains_account": float(balance > 0 and txn.amount >= 0.9 * balance),
            "is_new_payee": float(new_payee),
            "sender_txn_count": float(count),
            "amount_vs_sender_mean": vs_mean,
            "sender_txns_1h": float(last_hour),
            "payee_first_seen": float(first_seen),
            "payee_inbound_senders_24h": float(inbound_senders),
        }

    def update(self, txn: Txn) -> None:
        s = self.senders.get(txn.account_id)
        if s is None:
            s = self.senders[txn.account_id] = _Sender()
        s.count += 1
        s.amount_sum += txn.amount
        s.payees.add(txn.payee_id)
        s.recent.append(txn.ts)

        inbound = self.payee_inbound.get(txn.payee_id)
        if inbound is None:
            inbound = self.payee_inbound[txn.payee_id] = deque(maxlen=_INBOUND_MAXLEN)
        inbound.append((txn.ts, txn.account_id))

    def vector(self, feats: dict[str, float]) -> list[float]:
        return [feats[name] for name in FEATURES]

    def stats(self) -> dict[str, int]:
        return {"accounts": len(self.senders), "payees": len(self.payee_inbound)}

    def dump(self, path: Path) -> None:
        with gzip.open(path, "wb") as f:
            pickle.dump(self, f, protocol=pickle.HIGHEST_PROTOCOL)

    @staticmethod
    def load(path: Path) -> FeatureState:
        # Only load snapshots produced by our own ml/ pipeline.
        with gzip.open(path, "rb") as f:
            state = pickle.load(f)
        if not isinstance(state, FeatureState):
            raise TypeError(f"{path} is not a FeatureState snapshot")
        return state
