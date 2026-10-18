import math

import pytest

from scorer.features import FEATURES, FeatureState, Txn, step_to_ts
from scorer.policy import Policy
from scorer.reasons import REASONS, explain


def feats_for(**overrides):
    f = FeatureState().features(Txn("A", "P", 48_500, "TRANSFER", step_to_ts(23), 50_000))
    f.update(overrides)
    return f


def contribs(**by_feature):
    return [by_feature.get(name, 0.0) for name in FEATURES]


def test_every_reason_maps_to_real_features():
    for names, _ in REASONS.values():
        assert set(names) <= set(FEATURES)


def test_top_reasons_sorted_by_weight():
    f = feats_for()
    out = explain(f, contribs(is_new_payee=0.4, is_odd_hour=0.3, balance_drain_ratio=0.9, log_amount=0.01))
    assert [r["code"] for r in out] == ["BALANCE_DRAIN", "NEW_PAYEE", "ODD_HOUR"]


def test_reason_dropped_when_not_literally_true():
    # SHAP says the hour mattered, but 2pm is not an odd hour, so we don't claim it.
    f = feats_for(hour_of_day=14.0, is_odd_hour=0.0)
    out = explain(f, contribs(hour_of_day=0.5))
    assert "ODD_HOUR" not in [r["code"] for r in out]


def test_negative_contributions_never_become_reasons():
    assert explain(feats_for(), contribs(is_new_payee=-1.0)) == []


def test_nan_features_do_not_crash():
    f = feats_for(amount_vs_sender_mean=math.nan)
    assert explain(f, contribs(amount_vs_sender_mean=1.0)) == []


@pytest.mark.parametrize(("risk", "action"), [(0.0, "allow"), (0.29, "allow"), (0.3, "verify"), (0.8, "hold")])
def test_policy(risk, action):
    assert Policy("v", 0.3, 0.8).decide(risk) == action


def test_policy_rejects_inverted_thresholds():
    with pytest.raises(ValueError):
        Policy("v", 0.9, 0.5)
