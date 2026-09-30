"""C4 / C5 / C10: promotion gates, model metadata, goal-model replay and fitted constants."""
import glob
import json
import os

import pytest

import retrain as R

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
PIPE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(name):
    with open(os.path.join(OUT, name)) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def meta():
    with open(os.path.join(PIPE, 'game_model_meta.json')) as f:
        return json.load(f)


def _fold(s, ll, home=0.70, slope=1.0):
    return {'test_season': s, 'log_loss': ll, 'calibration_slope': slope,
            'home_rate_baseline': {'log_loss': home}}


def test_promotion_gates():
    cur = {'cv_results': [_fold(2023, 0.66), _fold(2024, 0.67), _fold(2025, 0.68)]}
    good = {'cv_results': [_fold(2023, 0.659), _fold(2024, 0.67), _fold(2025, 0.6803)]}
    assert R.promotion_checks(good, cur)[0] is True
    worse = {'cv_results': [_fold(2023, 0.659), _fold(2024, 0.672), _fold(2025, 0.68)]}
    assert R.promotion_checks(worse, cur)[0] is False
    near_home = {'cv_results': [_fold(2023, 0.66, home=0.665), _fold(2024, 0.67), _fold(2025, 0.68)]}
    assert R.promotion_checks(near_home, cur)[0] is False
    miscal = {'cv_results': [_fold(2023, 0.66), _fold(2024, 0.67), _fold(2025, 0.68, slope=0.8)]}
    assert R.promotion_checks(miscal, cur)[0] is False


def test_meta_records_version_features_and_folds(meta):
    for k in ('training_date', 'feature_columns', 'cv_results', 'model_version'):
        assert meta.get(k)
    assert {f['test_season'] for f in meta['cv_results']} == {2023, 2024, 2025}


def test_live_model_beats_legacy_and_home_rate(meta):
    for f in meta['cv_results']:
        assert f['log_loss'] <= f['legacy_xgb_same_games']['log_loss'] or \
            f['legacy_xgb_same_games']['new_model_log_loss'] <= f['legacy_xgb_same_games']['log_loss']
        assert f['home_rate_baseline']['log_loss'] - f['log_loss'] >= 0.01
    last = max(meta['cv_results'], key=lambda f: f['test_season'])
    assert 0.9 <= last['calibration_slope'] <= 1.1


def test_early_season_beats_constant(meta):
    assert meta['early_season_pooled']['log_loss'] <= 0.690


def test_goal_model_replay():
    r = _load('goal_model_replay.json')
    assert r['n'] > 1000
    assert r['xg_favourite_differs_from_win_favourite'] == 0.0
    assert abs(r['total_bias']) <= 0.10


def test_every_used_constant_has_fit_se_and_ablation():
    c = _load('constants_fit.json')['constants']
    for name, v in c.items():
        assert v['fit'] and v['se'] is not None, name
        if v.get('used_by_model', True):
            assert v.get('ablation') is not None, name
    with open(os.path.join(PIPE, 'scoring_coefficients.json')) as f:
        coeffs = json.load(f)
    for k in ('ot_decided_share', 'total_pace_weight', 'total_scale', 'market_blend_weight'):
        assert isinstance(coeffs[k], dict) and 'value' in coeffs[k]


def test_candidate_features_have_ablations():
    a = _load('feature_ablation.json')
    names = {r['name'] for r in a['results']}
    assert {'travel_km', 'time_zone_shift', 'three_in_four'} <= names
    for r in a['results']:
        assert r['decision']


OWNED = ['ml_predict.py', 'train_game_model.py', 'team_ratings.py', 'shooting_talent.py', 'features.py',
         'market.py', 'goal_model.py', 'model_report.py', 'grade_bets.py', 'retrain.py', 'generate_history.py',
         'lineup_adjust.py']


def test_no_hand_waved_constants_in_model_code():
    for name in OWNED:
        p = os.path.join(PIPE, name)
        if not os.path.exists(p):
            continue
        text = open(p).read().lower()
        assert 'common sense' not in text and 'per user request' not in text and 'user request' not in text, name
