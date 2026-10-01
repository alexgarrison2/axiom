"""Fast track F1 gate (DESIGN §8 F1, §1.7 A2/A3/A5): the gate maths, the
committed backtest report, and agreement between the report and the live model."""
import json
import os

import numpy as np
import pandas as pd
import pytest

import features as F
import retrain as R

PIPE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _oos(p, y, seasons):
    return pd.DataFrame({'game_id': np.arange(len(p)), 'season': seasons, 'home_win': y, 'p_model': p,
                         'early': False})


def _folds(oos, home=0.70):
    return {s: {'log_loss': float(R._ll_vec(g['home_win'], g['p_model']).mean()), 'brier': 0.0,
                'calibration_slope': R.calibration_slope_ci(g['home_win'], g['p_model'])[0],
                'home_rate_baseline': {'log_loss': home}} for s, g in oos.groupby('season')}


def test_calibration_slope_ci_recovers_known_slope():
    rng = np.random.default_rng(1)
    z = rng.normal(0, 0.6, 20000)
    y = (rng.random(20000) < 1 / (1 + np.exp(-z))).astype(int)
    b, se, (lo, hi) = R.calibration_slope_ci(y, 1 / (1 + np.exp(-z)))
    assert lo <= 1 <= hi and 0 < se < 0.05
    b2, _, (lo2, hi2) = R.calibration_slope_ci(y, 1 / (1 + np.exp(-1.5 * z)))   # overconfident model
    assert hi2 < 1 and abs(b2 - 1 / 1.5) < 0.05


def test_gate_passes_a_better_model_and_fails_a_worse_fold():
    rng = np.random.default_rng(2)
    n = 3000
    seasons = np.repeat([2023, 2024, 2025], n // 3)
    z = rng.normal(0, 0.5, n)
    y = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    base = _oos(1 / (1 + np.exp(-(0.6 * z))), y, seasons)
    better = _oos(1 / (1 + np.exp(-z)), y, seasons)
    g = R.ft_gate(base, better, _folds(better))
    assert g['passed'] and g['pooled']['delta'] < 0
    # one fold made worse than +0.0005 fails the gate even if pooled is fine
    worse = better.copy()
    m = worse['season'] == 2024
    worse.loc[m, 'p_model'] = 1 / (1 + np.exp(-(0.1 * z[m.values])))
    g2 = R.ft_gate(base, worse, _folds(worse))
    assert not g2['passed']
    assert any(c['check'].startswith('2024 fold') and not c['passed'] for c in g2['checks'])
    # not beating the home-rate constant by 0.01 fails
    g3 = R.ft_gate(base, better, _folds(better, home=0.60))
    assert not g3['passed']
    # an overconfident latest fold breaks the standing promotion_checks calibration rule
    folds = _folds(better)
    folds[2025]['calibration_slope'] = 0.84
    g4 = R.ft_gate(base, better, folds)
    assert not g4['passed'] and [c for c in g4['checks'] if not c['passed']][0]['check'].startswith('2025 calibration')


REPORT = R.FT_REPORT


@pytest.fixture(scope='module')
def report():
    if not os.path.exists(REPORT):
        pytest.skip('fasttrack backtest not run')
    with open(REPORT) as f:
        return json.load(f)


def test_report_has_per_fold_numbers_and_leakage_evidence(report):
    assert report['folds'] == [2023, 2024, 2025]
    lk = report['leakage']
    assert lk['rows_checked'] > 3000
    assert lk['ratings_asof_before_game_date'] and lk['ratings_data_seasons_before_game_season'] \
        and lk['lineup_history_before_game_date']
    for name, c in report['candidates'].items():
        g = c['gate']
        assert set(g['per_fold']) == {'2023', '2024', '2025'}, name
        for f in g['per_fold'].values():
            assert f['n'] > 1000 and 'delta' in f and 'se' in f
        assert len(g['calibration']['ci95']) == 2
    if report['selected']:
        assert report['candidates'][report['selected']]['dev_delta'] < 0


def test_live_model_matches_the_gate_decision(report):
    with open(os.path.join(PIPE, 'game_model_meta.json')) as f:
        meta = json.load(f)
    live_ft = [c for c in meta['feature_columns'] if c in R.FT_COLUMNS]
    if any(c in meta['feature_columns'] for c in F.BU_COLUMNS):
        # superseded by the joint xG v2 + RAPM lineup model (retrain --joint): the F1 model is
        # the rollback shadow and must carry its gate record there
        with open(os.path.join(PIPE, meta['shadow']['f1']['meta'])) as f:
            shadow = json.load(f)
        assert not live_ft and shadow.get('fasttrack', {}).get('gate_passed') is True
        return
    if report['selected_passed']:
        assert live_ft and meta.get('fasttrack', {}).get('gate_passed') is True
    else:
        # a failed gate keeps the feature behind the flag: the live model must not use it
        assert not live_ft
