"""Give the /pay demo customer a believable payment history so 'usual payee'
and 'unusual amount' mean something on stage. The profile is a typical customer
from the training data: ~20 payments a month, regular shop, family and rent."""

from __future__ import annotations

import time

from .features import FeatureState, Txn

DEMO_ACCOUNT = "C-DEMO-PRIYA"
DEMO_BALANCE = 52_000.0

_HISTORY = [
    # (payee, amount, type, days_ago, hour)
    *[("M-GROCER-ANNAI", a, "PAYMENT", d, h) for a, d, h in [
        (640, 1, 9), (820, 4, 10), (560, 7, 18), (910, 11, 9), (480, 14, 19), (700, 18, 10),
        (1_150, 21, 11), (620, 25, 18), (760, 29, 9), (540, 33, 17), (880, 38, 10), (690, 44, 19),
    ]],
    *[("C-AMMA", a, "TRANSFER", d, h) for a, d, h in [
        (3_000, 6, 20), (2_500, 20, 19), (5_000, 35, 20), (3_000, 50, 21),
    ]],
    *[("C-RAVI-LANDLORD", 9_200, "TRANSFER", d, 15) for d in (28, 58)],
    ("M-EB-TNPDCL", 1_450, "PAYMENT", 12, 11),
    ("M-EB-TNPDCL", 1_320, "PAYMENT", 42, 12),
    ("M-JIO-RECHARGE", 299, "PAYMENT", 15, 13),
    ("M-JIO-RECHARGE", 299, "PAYMENT", 45, 14),
    ("M-PHARMACY-APOLLO", 430, "PAYMENT", 9, 20),
    ("M-SWIGGY", 380, "PAYMENT", 3, 21),
    ("M-SWIGGY", 520, "PAYMENT", 16, 21),
]  # fmt: skip


def seed(state: FeatureState, now: float | None = None) -> None:
    now = now or time.time()
    day_start = now - (now % 86400)
    for payee, amount, type_, days_ago, hour in sorted(_HISTORY, key=lambda h: -h[3]):
        ts = day_start - days_ago * 86400 + hour * 3600 - 5.5 * 3600
        state.update(Txn(DEMO_ACCOUNT, payee, float(amount), type_, ts, DEMO_BALANCE))
