"""model_report.py scoring rules: pick'em prices, legacy split, best-call floor."""
import model_report as MR


def _row(gid, home_p, home_won, market=None, version=None, date='2026-10-01'):
    return {'gameId': gid, 'date': date, 'homeTeam': 'Bruins', 'awayTeam': 'Rangers',
            'homeScore': 3 if home_won else 1, 'awayScore': 1 if home_won else 3, 'decision': 'REG',
            'homeWinProb': home_p, 'predictedWinner': 'Bruins' if home_p >= 50 else 'Rangers',
            'actualWinner': 'Bruins' if home_won else 'Rangers',
            'isCorrect': (home_p >= 50) == home_won, 'retro': False,
            'marketHomeProb': market, 'modelVersion': version}


def test_acc_scores_a_pickem_as_half():
    assert MR._acc([1], [0.5]) == 0.5
    assert MR._acc([0], [0.5]) == 0.5
    assert MR._acc([1, 0], [0.6, 0.6]) == 0.5
    assert MR._acc([1, 1, 0], [0.5, 0.7, 0.7]) == 0.5
    assert MR._acc([], []) is None


def test_market_pickem_is_not_a_miss():
    rows = [_row(1, 50.3, True, market=50.0), _row(2, 71.9, False, market=74.2), _row(3, 75.1, True, market=71.7)]
    b = MR.block(rows, 0.536, 'test', {})
    # 0.5 (pick'em) + 0 + 1 over three games
    assert abs(b['baselines']['market']['accuracy'] - 0.5) < 1e-9
    assert b['baselines']['market']['model_brier_same_games'] is not None


def test_block_splits_by_model_version():
    rows = [_row(1, 60, True), _row(2, 60, False, version='logit-elo-v5'), _row(3, 70, True, version='logit-elo-v5')]
    b = MR.block(rows, 0.536, 'test', {})
    assert b['n_legacy'] == 1
    assert b['by_model']['legacy']['n'] == 1
    assert b['by_model']['current']['n'] == 2
    assert b['by_model']['current']['correct'] == 1
    empty = MR.block([], 0.536, 'test', {})
    assert empty['n_legacy'] == 0 and empty['by_model']['current']['n'] == 0


def test_best_calls_need_a_real_lean():
    rows = [_row(1, 50.3, True), _row(2, 75.1, True), _row(3, 54.9, False), _row(4, 71.9, False)]
    b = MR.block(rows, 0.536, 'test', {})
    assert [c['gameId'] for c in b['best_calls']] == [2]
    assert [c['gameId'] for c in b['worst_misses']] == [4]
    assert b['best_calls'][0]['legacy'] is True
