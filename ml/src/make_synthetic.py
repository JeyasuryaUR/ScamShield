"""Generate a PaySim-schema dataset with realistic *scam* behaviour.

Why: in real PaySim almost every sender appears once, so "new payee" or "unusual
amount for this customer" can't be learned. This generator keeps PaySim's columns
but gives customers a history, regular payees and daily rhythms, then injects
authorised-push-payment scams:

  - victim sends 1-3 TRANSFERs to a mule (usually a new payee), often draining the
    account, sometimes late at night, sometimes after a small "test" transfer;
  - ~10% of scams go to an existing contact (compromised account), to keep it hard;
  - mules work in short campaigns (several victims in ~2 days), then CASH_OUT.

Usage: python ml/src/make_synthetic.py [--customers 25000] [--days 30] [--seed 42]
"""

from __future__ import annotations

import argparse
import csv

import numpy as np
from common import RAW

# Relative activity by local hour: quiet at night, busy daytime/evening.
DAY_PROFILE = np.array(
    [0.4, 0.2, 0.1, 0.1, 0.1, 0.3, 1, 2, 4, 6, 7, 7, 7, 6, 6, 6, 6, 7, 8, 8, 7, 5, 3, 1.5], dtype=float
)
DAY_PROFILE /= DAY_PROFILE.sum()
# Scam calls: daytime "KYC update" calls plus a late-night peak.
SCAM_PROFILE = np.array([5, 4, 3, 1, 0.5, 0.5, 1, 2, 3, 4, 5, 5, 5, 4, 4, 4, 4, 4, 4, 5, 6, 7, 8, 7], dtype=float)
SCAM_PROFILE /= SCAM_PROFILE.sum()

LEGIT_TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
LEGIT_TYPE_P = [0.55, 0.20, 0.12, 0.10, 0.03]


def rand_id(rng, prefix: str, used: set) -> str:
    while True:
        i = f"{prefix}{rng.integers(10**8, 10**10)}"
        if i not in used:
            used.add(i)
            return i


def generate(n_customers: int, days: int, seed: int, victim_rate: float) -> list[tuple]:
    rng = np.random.default_rng(seed)
    used: set[str] = set()
    customers = [rand_id(rng, "C", used) for _ in range(n_customers)]
    merchants = [rand_id(rng, "M", used) for _ in range(max(500, n_customers // 8))]
    agents = [rand_id(rng, "C", used) for _ in range(max(200, n_customers // 50))]
    steps = days * 24

    events: list[list] = []  # [t, type, amount_hint, orig, dest, is_fraud, kind]

    profiles = {}
    for c in customers:
        scale = float(rng.lognormal(np.log(1500), 0.8))
        balance = float(rng.lognormal(np.log(40_000), 0.9))
        n_reg = int(rng.integers(2, 8))
        regular = [
            merchants[rng.integers(len(merchants))] if rng.random() < 0.7 else customers[rng.integers(n_customers)]
            for _ in range(n_reg)
        ]
        regular_people = [p for p in regular if p.startswith("C")] or [customers[rng.integers(n_customers)]]
        regular_merch = [p for p in regular if p.startswith("M")] or [merchants[rng.integers(len(merchants))]]
        profiles[c] = (scale, balance, regular_people, regular_merch)

        n_tx = rng.poisson(rng.gamma(2.0, 12.0) * days / 30)
        ts = rng.integers(days, size=n_tx) * 24 + rng.choice(24, size=n_tx, p=DAY_PROFILE) + rng.random(n_tx)
        kinds = rng.choice(LEGIT_TYPES, size=n_tx, p=LEGIT_TYPE_P)
        amounts = rng.lognormal(np.log(scale), 0.6, size=n_tx)
        big = rng.random(n_tx) < 0.03  # a legit big purchase / rent / gift
        amounts[big] *= rng.uniform(5, 20, size=int(big.sum()))
        regular_hit = rng.random(n_tx)
        pick = rng.integers(1 << 30, size=n_tx)
        for t, kind, amount, r, k in zip(ts, kinds, amounts, regular_hit, pick, strict=True):
            if kind == "PAYMENT":
                dest = regular_merch[k % len(regular_merch)] if r < 0.85 else merchants[k % len(merchants)]
            elif kind == "TRANSFER":
                dest = regular_people[k % len(regular_people)] if r < 0.8 else customers[k % n_customers]
            else:
                dest = agents[k % len(agents)]
                if kind == "CASH_IN":
                    amount *= 3
            events.append([float(t), str(kind), float(amount), c, dest, 0, "legit"])

        # Large transfers to someone they already pay (rent, family support, fees). Without these
        # the model would learn "big transfer = scam" instead of "big transfer to a *new* payee".
        if rng.random() < 0.7:
            big_payee, big_amount = regular_people[0], scale * rng.uniform(3, 10)
            for _ in range(rng.poisson(2.0 * days / 30)):
                t = rng.integers(days) * 24 + rng.choice(24, p=DAY_PROFILE) + rng.random()
                amount = big_amount * rng.uniform(0.9, 1.1)
                events.append([float(t), "TRANSFER", float(amount), c, big_payee, 0, "legit"])

        # salary twice a month keeps balances realistic
        for day in range(1, days, 15):
            events.append([day * 24 + 9 + rng.random(), "CASH_IN", balance * 0.4, c, agents[0], 0, "salary"])

    # --- scams -------------------------------------------------------------
    victims = rng.choice(customers, size=int(n_customers * victim_rate), replace=False)
    groups: list[int] = []  # victims per mule campaign
    while sum(groups) < len(victims):
        groups.append(int(rng.integers(2, 7)))
    # Stratified start times: every stretch of the timeline gets campaigns (in random order),
    # so the time-based test split always contains scams, whatever the seed or size.
    slots = rng.permutation(len(groups))
    mule_slots: list[tuple[str, float]] = []  # (mule, campaign start)
    for group, slot in zip(groups, slots, strict=True):
        start = (slot + rng.random()) / len(groups) * (steps - 48)
        mule_slots += [(rand_id(rng, "C", used), start)] * group

    for victim, (mule, start) in zip(victims, mule_slots, strict=False):  # more slots than victims
        scale, balance, regular_people, _ = profiles[victim]
        day_offset = rng.uniform(0, 48)
        t = int((start + day_offset) // 24) * 24 + rng.choice(24, p=SCAM_PROFILE) + rng.random() * 0.5
        t = min(t, steps - 1.01)
        dest = regular_people[rng.integers(len(regular_people))] if rng.random() < 0.1 else mule
        kind = "TRANSFER" if rng.random() < 0.85 else "PAYMENT"
        if rng.random() < 0.3:  # small test transfer first
            events.append([t, kind, float(rng.uniform(1, 500)), victim, dest, 1, "scam"])
            t += 0.05
        n_main = int(rng.choice([1, 1, 1, 2, 3]))
        for k in range(n_main):
            if rng.random() < 0.65:
                amount = -rng.uniform(0.5, 1.0) / n_main  # negative = fraction of live balance
            else:
                amount = scale * rng.uniform(4, 15)
            events.append([t + 0.1 * (k + 1), kind, amount, victim, dest, 1, "scam"])

    events.sort(key=lambda e: e[0])

    # --- balances (and mule cash-outs) in time order -------------------------
    balances: dict[str, float] = {c: profiles[c][1] for c in customers}
    for m in merchants + agents:
        balances[m] = float(rng.lognormal(np.log(500_000), 1.0))
    mule_cashouts: list[list] = []
    rows: list[tuple] = []

    def emit(t, kind, amount, orig, dest, fraud):
        amount = round(float(amount), 2)
        ob, od = balances.get(orig, 0.0), balances.get(dest, 0.0)
        if kind == "CASH_IN":
            nb, nd = ob + amount, max(od - amount, 0.0)
        else:
            nb, nd = max(ob - amount, 0.0), od + amount
        balances[orig], balances[dest] = nb, nd
        flagged = int(kind == "TRANSFER" and amount > 200_000)
        rows.append(
            (int(t), kind, amount, orig, round(ob, 2), round(nb, 2), dest, round(od, 2), round(nd, 2), fraud, flagged)
        )

    for t, kind, amount, orig, dest, _fraud, label in events:
        bal = balances.get(orig, 0.0)
        if label == "scam":
            amount = bal * -amount if amount < 0 else min(amount, bal)
            if amount < 1:
                continue
            emit(t, kind, amount, orig, dest, 1)
            if dest not in profiles:  # a real mule, not a compromised contact
                mule_cashouts.append([t + rng.uniform(1, 6), dest])
            continue
        if kind != "CASH_IN" and amount > bal:
            if bal < 100:
                continue
            amount = bal * rng.uniform(0.1, 0.5)
        emit(t, kind, amount, orig, dest, 0)

    # mules cash out everything they received, a few hours later
    seen = set()
    for t, mule in sorted(mule_cashouts):
        if mule in seen or t >= steps:
            continue
        seen.add(mule)
        if balances.get(mule, 0) > 1:
            emit(t, "CASH_OUT", balances[mule], mule, agents[rng.integers(len(agents))], 1)

    # stable sort by step keeps intra-hour order (test transfer before main one)
    return sorted(rows, key=lambda r: r[0])


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--customers", type=int, default=25_000)
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--victim-rate", type=float, default=0.016)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args()

    rows = generate(a.customers, a.days, a.seed, a.victim_rate)
    out = RAW / "synthetic_paysim.csv"
    with out.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "step",
                "type",
                "amount",
                "nameOrig",
                "oldbalanceOrg",
                "newbalanceOrig",
                "nameDest",
                "oldbalanceDest",
                "newbalanceDest",
                "isFraud",
                "isFlaggedFraud",
            ]
        )
        w.writerows(rows)
    fraud = sum(r[9] for r in rows)
    print(f"wrote {len(rows):,} rows ({fraud:,} fraud, {fraud / len(rows):.3%}) to {out}")


if __name__ == "__main__":
    main()
