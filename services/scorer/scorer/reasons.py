"""Turn per-feature SHAP contributions into a short list of reason codes.

SHAP decides which signals pushed the risk up; a plain rule then checks the
statement is literally true for this payment ("new payee" only if it really is
a new payee). That keeps every reason an analyst sees both important and true.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from .features import FEATURES, TXN_TYPES

Feats = dict[str, float]


def _gte(name: str, value: float) -> Callable[[Feats], bool]:
    return lambda f: not math.isnan(f[name]) and f[name] >= value


# reason code -> (features whose contributions roll up into it, condition that must hold)
REASONS: dict[str, tuple[tuple[str, ...], Callable[[Feats], bool]]] = {
    "NEW_PAYEE": (("is_new_payee",), _gte("is_new_payee", 1)),
    "AMOUNT_SPIKE": (("amount_vs_sender_mean",), _gte("amount_vs_sender_mean", 3)),
    "HIGH_AMOUNT": (("log_amount",), _gte("log_amount", math.log1p(50_000))),
    "ODD_HOUR": (("hour_of_day", "is_odd_hour"), _gte("is_odd_hour", 1)),
    "BALANCE_DRAIN": (("balance_drain_ratio", "drains_account"), _gte("balance_drain_ratio", 0.8)),
    "HIGH_VELOCITY": (("sender_txns_1h",), _gte("sender_txns_1h", 3)),
    "UNKNOWN_PAYEE": (("payee_first_seen",), _gte("payee_first_seen", 1)),
    "MULE_PATTERN": (("payee_inbound_senders_24h",), _gte("payee_inbound_senders_24h", 3)),
    "THIN_HISTORY": (("sender_txn_count",), lambda f: f["sender_txn_count"] < 3),
    "RISKY_TYPE": (
        ("type_code",),
        lambda f: f["type_code"] in (TXN_TYPES.index("TRANSFER"), TXN_TYPES.index("CASH_OUT")),
    ),
}

_INDEX = {name: i for i, name in enumerate(FEATURES)}


def explain(feats: Feats, contribs: Sequence[float], top_k: int = 3, min_weight: float = 0.05) -> list[dict]:
    """contribs: one log-odds contribution per feature in FEATURES order (bias excluded)."""
    scored = []
    for code, (names, holds) in REASONS.items():
        weight = sum(contribs[_INDEX[n]] for n in names)
        if weight >= min_weight and holds(feats):
            scored.append((weight, code))
    scored.sort(reverse=True)
    return [{"code": code, "weight": round(w, 4)} for w, code in scored[:top_k]]
