import math

from scorer.features import EPOCH_BASE, FEATURES, FeatureState, Txn, local_hour, step_to_ts


def txn(payee="P1", amount=100.0, ts=EPOCH_BASE + 10 * 3600, balance=1000.0, account="A1", type_="TRANSFER"):
    return Txn(account, payee, amount, type_, ts, balance)


def test_step_zero_is_local_midnight():
    assert local_hour(step_to_ts(0)) == 0
    assert local_hour(step_to_ts(23)) == 23
    assert local_hour(step_to_ts(25)) == 1


def test_first_payment_has_no_history():
    f = FeatureState().features(txn())
    assert f["is_new_payee"] == 1
    assert f["sender_txn_count"] == 0
    assert math.isnan(f["amount_vs_sender_mean"])
    assert f["payee_first_seen"] == 1
    assert list(f) == FEATURES


def test_features_only_use_the_past():
    s = FeatureState()
    first = txn(amount=100)
    before = s.features(first)
    s.update(first)
    after = s.features(txn(amount=500, ts=first.ts + 60))
    assert before["sender_txn_count"] == 0
    assert after["sender_txn_count"] == 1
    assert after["is_new_payee"] == 0
    assert after["amount_vs_sender_mean"] == 5.0
    assert after["sender_txns_1h"] == 1


def test_velocity_window_and_mule_pattern():
    s = FeatureState()
    t0 = EPOCH_BASE
    for i in range(4):
        s.update(txn(account=f"victim{i}", payee="MULE", ts=t0 + i * 60))
    f = s.features(txn(account="victim9", payee="MULE", ts=t0 + 600))
    assert f["payee_inbound_senders_24h"] == 4
    assert f["payee_first_seen"] == 0
    later = s.features(txn(account="victim9", payee="MULE", ts=t0 + 2 * 86400))
    assert later["payee_inbound_senders_24h"] == 0


def test_balance_drain():
    f = FeatureState().features(txn(amount=950, balance=1000))
    assert f["drains_account"] == 1
    assert abs(f["balance_drain_ratio"] - 0.95) < 1e-9
    assert math.isnan(FeatureState().features(txn(balance=0))["balance_drain_ratio"])


def test_snapshot_roundtrip(tmp_path):
    s = FeatureState()
    s.update(txn())
    s.dump(tmp_path / "s.pkl.gz")
    restored = FeatureState.load(tmp_path / "s.pkl.gz")
    assert restored.features(txn(ts=EPOCH_BASE + 11 * 3600)) == s.features(txn(ts=EPOCH_BASE + 11 * 3600))
