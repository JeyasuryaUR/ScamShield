from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .features import TXN_TYPES

TxnType = Literal["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
assert set(TxnType.__args__) == set(TXN_TYPES)


class ScoreRequest(BaseModel):
    txn_id: str = Field(min_length=1, max_length=64)
    account_id: str = Field(min_length=1, max_length=64)
    payee_id: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0, lt=1e10)
    type: TxnType
    ts: datetime
    old_balance: float = Field(ge=0)
    channel: str = Field(default="stream", max_length=32)
    # False = score without adding to the account's history (e.g. history updates on settlement,
    # or a repeatable demo). The stream replayer leaves it True.
    update_history: bool = True


class Reason(BaseModel):
    code: str
    weight: float


class ScoreResponse(BaseModel):
    txn_id: str
    risk: float
    action: Literal["allow", "verify", "hold"]
    reasons: list[Reason]
    model_version: str
    latency_ms: float


class Health(BaseModel):
    status: Literal["ok"]
    model_version: str
    verify_threshold: float
    hold_threshold: float
    accounts: int
    payees: int
    sink: dict


class LatencyStats(BaseModel):
    count: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    tps_1m: float
