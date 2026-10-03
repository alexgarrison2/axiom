"""C2: de-vig, blend, EV as a fraction, Kelly and the proven-edge gate."""
import json
import math
import os

import pytest

import market


def test_devig_power_sums_to_one_and_removes_margin():
    q = market.devig([-110, -110])
    assert abs(sum(q) - 1) < 1e-9 and abs(q[0] - 0.5) < 1e-9
    q = market.devig([-275, 225])
    assert abs(sum(q) - 1) < 1e-9
    raw = market.implied(-275)
    assert q[0] < raw                     # margin removed from the favourite
    # power method shades the longshot more than proportional does
    qp = market.devig([-275, 225], 'proportional')
    assert q[1] < qp[1]


@pytest.mark.parametrize('ev,expected', [(0.003, False), (0.049, False), (0.051, True)])
def test_ev_threshold_is_a_fraction(ev, expected):
    assert market.passes_ev(ev, 0.05) is expected


def test_ev_from_returns_fraction():
    ev = market.ev_from(0.55, -110)
    assert abs(ev - (0.55 * (100 / 110 + 1) - 1)) < 1e-12
    assert -1 < ev < 1


def test_blend_falls_back_to_model_without_odds():
    assert market.blend(0.61, None, 0.3) == 0.61
    b = market.blend(0.61, 0.50, 0.3)
    assert abs(b - 1 / (1 + math.exp(-0.3 * math.log(0.61 / 0.39)))) < 1e-12


def test_quarter_kelly():
    # even money, p = 0.55 -> full Kelly 10% -> quarter 2.5% -> 2.5 units
    assert market.kelly_units(0.55, 100) == 2.5
    assert market.kelly_units(0.45, 100) == 0.0


def _state(ci_low, clv, n=250, model_ll=0.66, market_ll=0.67):
    return {'backtest': {'roi_ci_low': ci_low, 'clv_mean': clv, 'n': 100, 'roi': 0.05},
            'rolling': {'n': n, 'model_log_loss': model_ll, 'market_log_loss': market_ll}}


def test_gate_closed_site_wide_when_backtest_fails():
    for ci, clv in [(-0.03, 0.01), (0.01, -0.001), (-0.02, 0.0)]:
        ok, reasons = market.gate(0.2, 40, 40, state=_state(ci, clv))
        assert ok is False and reasons
        g = market.price_game(0.70, -110, -110, 40, 40, state=_state(ci, clv))
        assert g['units'] is None and g['ev_gated'] is False


def test_gate_open_only_with_all_conditions():
    good = _state(0.001, 0.01)
    assert market.gate(0.05, 40, 40, state=good)[0] is True
    assert market.gate(0.02, 40, 40, state=good)[0] is False            # EV below 3%
    assert market.gate(0.05, 5, 40, state=good)[0] is False             # early season
    assert market.gate(0.05, 5, 40, state=good, preseason_prior=False)[0] is True
    assert market.gate(0.05, 40, 40, state=_state(0.001, 0.01, n=150))[0] is False   # too few live games
    assert market.gate(0.05, 40, 40, state=_state(0.001, 0.01, model_ll=0.68))[0] is False


def test_owner_weight_and_fitted_override(monkeypatch):
    """The published weight is the owner's 0.80 every game; PONYXG_MODEL_WEIGHT overrides it."""
    monkeypatch.delenv(market.WEIGHT_ENV, raising=False)
    assert market.effective_weight(0.74, 0, 0) == market.OWNER_MODEL_WEIGHT == 0.80
    assert market.effective_weight(0.2, 40, 40) == 0.80
    monkeypatch.setenv(market.WEIGHT_ENV, "0.5")
    assert market.effective_weight(0.74, 0, 0) == 0.5
    monkeypatch.setenv(market.WEIGHT_ENV, "fitted")
    assert abs(market.effective_weight(0.74, 0, 0) - 0.2) < 1e-12        # ramp start
    assert abs(market.effective_weight(0.74, 20, 30) - 0.74) < 1e-12     # fitted after 20 GP


def test_pickem_units_empty_unless_gate_open(monkeypatch):
    """-110/-120 pick'em with a bullish model: EV from the BLENDED prob, no units while closed."""
    monkeypatch.setenv(market.WEIGHT_ENV, "fitted")
    closed = _state(-0.09, -0.05)
    g = market.price_game(0.631, -110, -120, 0, 0, state=closed, w=0.74)
    q = market.devig([-110, -120])[0]
    assert abs(g['market_prob_home'] - q) < 1e-12
    w_eff = market.effective_weight(0.74, 0, 0)
    assert abs(w_eff - 0.2) < 1e-12
    assert abs(g['blended_prob_home'] - market.blend(0.631, q, w_eff)) < 1e-12
    assert abs(g['ev_home'] - market.ev_from(g['blended_prob_home'], -110)) < 1e-12
    assert g['units'] is None
    assert abs(g['market_prob_home'] + (1 - g['market_prob_home']) - 1) < 1e-12


def test_backtest_report_exists_with_required_fields():
    path = os.path.join(os.path.dirname(market.__file__), 'tests', 'out', 'market_backtest.json')
    with open(path) as f:
        rep = json.load(f)
    assert rep['sample']['n_games'] >= 400
    assert 'live_value' in rep['blend_weight']
    rule = rep['betting_replay']['rule']
    for k in ('roi', 'roi_ci_low', 'roi_ci_high', 'clv_mean'):
        assert rule[k] is not None
    assert rep['log_loss']['blend_walk_forward'] <= 0.6745
    # the committed evidence must close the gate when it is weak
    ev = rep['gate_evidence']
    if ev['roi_ci_low'] <= -0.02 or ev['clv_mean'] <= 0:
        assert rep['gate']['open'] is False
