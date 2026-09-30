"""C1: one model path all season (no silent opening-night fallback)."""
import pandas as pd

import goal_model
from ml_predict import MLPredictor


def test_opening_night_uses_ml_path():
    ml = MLPredictor(pd.DataFrame())          # current-season file empty
    assert ml.available
    r = ml.predict('Hurricanes', 'Panthers', '2026-09-29',
                   h_goalie='Brandon Bussi', a_goalie='Jacob Markstrom')
    assert r is not None
    assert ml.last_path == 'ml'
    assert 0.03 < r[0] < 0.97 and abs(r[0] + r[1] - 1) < 1e-12


def test_game_twenty_uses_same_path(feature_games):
    """Replay 2025-26 up to the date the Oilers had played 19 games."""
    g = feature_games
    oil = g[(g['season'] == 2025) & (g['team'] == 'Oilers')].sort_values('game_date')
    d20 = oil.iloc[19]['game_date']
    hist = g[g['game_date'] < d20]
    ml = MLPredictor(games=hist)
    opp = oil.iloc[19]['opponent']
    r = ml.predict('Oilers', opp, d20)
    assert r is not None and ml.last_path == 'ml'
    assert ml.last_detail['context']['h_gp'] == 19

    ml0 = MLPredictor(pd.DataFrame())
    ml0.predict('Oilers', opp, '2026-10-01')
    assert ml0.last_path == ml.last_path == 'ml'
    assert ml0.model_version == ml.model_version


def test_xg_favourite_matches_win_favourite():
    ml = MLPredictor(pd.DataFrame())
    for h, a in [('Oilers', 'Canucks'), ('Sharks', 'Avalanche'), ('Bruins', 'Rangers')]:
        p, _, hx, ax = ml.predict(h, a, '2026-10-02')
        assert (p > 0.5) == (hx > ax)


def test_logit_terms_sum_to_model_logit():
    import math
    ml = MLPredictor(pd.DataFrame())
    d = ml.predict_detail('Kings', 'Ducks', '2026-10-03')
    z = sum(t['logit'] for t in d['logit_terms'])
    p = d['model_prob_raw']
    assert abs(z - math.log(p / (1 - p))) < 1e-9
    rows, pf = goal_model.wp_breakdown([(t['factor'], t['label'], t['logit']) for t in d['logit_terms']],
                                       d['expected_total'])
    assert abs(50 + sum(r['wp_delta_pts'] for r in rows) - 100 * d['home_win_prob']) < 1e-9
