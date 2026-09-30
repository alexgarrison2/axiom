"""C7: team-relative, coverage-gated, injury-aware lineup term."""
import json
import os

import lineup_adjust as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'lineup_backtest.json')


def _adj(weight=0.5):
    values = {i: (i - 50) / 100 for i in range(100)}
    shares = {i: 0.3 for i in range(100)}
    names = {f'player {i}': i for i in range(100)}
    base = {'AAA': list(range(0, 18)), 'BBB': list(range(40, 58))}
    return L.LineupAdjuster(values, shares, base, names, weight=weight)


def test_normal_lineup_is_neutral():
    a = _adj()
    r = a.adjust('AAA', 'BBB', [f'player {i}' for i in range(18)], [f'player {i}' for i in range(40, 58)])
    assert r is not None and abs(r['logit']) < 1e-12
    p = 1 / (1 + 2.718281828 ** -(0.1 + r['logit']))
    assert abs(p - 1 / (1 + 2.718281828 ** -0.1)) <= 0.01


def test_coverage_gate_needs_14_of_18_on_both_sides():
    a = _adj()
    home = [f'player {i}' for i in range(18)]
    away_ok = [f'player {i}' for i in range(40, 54)] + ['nobody a', 'nobody b', 'nobody c', 'nobody d']
    away_short = [f'player {i}' for i in range(40, 53)] + ['nobody a', 'nobody b', 'nobody c', 'nobody d', 'nobody e']
    assert a.adjust('AAA', 'BBB', home, away_ok) is not None
    assert a.adjust('AAA', 'BBB', home, away_short) is None


def test_injured_players_are_removed_and_change_the_term():
    a = _adj()
    home = [f'player {i}' for i in range(17)] + ['player 99']      # a star replaces player 17
    away = [f'player {i}' for i in range(40, 58)]
    r1 = a.adjust('AAA', 'BBB', home, away)
    r2 = a.adjust('AAA', 'BBB', home, away, injured={'AAA': [{'name': 'Player 99', 'status': 'Out'}]})
    assert r1['logit'] > 0
    assert r2['home']['removed_injured'] == ['player 99'] and r2['logit'] < r1['logit']
    r3 = a.adjust('AAA', 'BBB', home, away, injured={'AAA': [{'name': 'Player 99', 'status': 'Day-To-Day'}]})
    assert r3['logit'] == r1['logit']


def test_backtest_decides_the_weight():
    with open(OUT) as f:
        rep = json.load(f)
    assert rep['games_eligible'] >= 500
    h = rep['held_out']
    improved = h['half_1_trained_tested_on_2']['with'] < h['half_1_trained_tested_on_2']['base'] and \
        h['half_2_trained_tested_on_1']['with'] < h['half_2_trained_tested_on_1']['base']
    if not improved:
        assert rep['lineup_weight'] == 0.0
    assert L.fitted_weight() == rep['lineup_weight']
