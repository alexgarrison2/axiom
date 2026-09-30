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


def test_coin_flip_forecast_is_not_a_hit():
    """0.503 is within 1 pt of 50 (isCoinFlip): no lean, so never counted as a hit."""
    assert MR.is_coin_flip(0.503) and MR.is_coin_flip(0.492) and MR.is_coin_flip(0.5)
    assert not MR.is_coin_flip(0.51) and not MR.is_coin_flip(0.49) and not MR.is_coin_flip(0.715)
    # Half credit for any forecaster inside the band, same as an exact pick'em.
    assert MR._acc([1], [0.503]) == 0.5
    assert MR._acc([0], [0.497]) == 0.5
    assert MR._acc([1], [0.51]) == 1.0
    # Opening night 2026-09-29: NYR@BOS at 50.3 (BOS won) is no lean, so the record is 1-1.
    rows = [_row(1, 50.3, True, market=50.0), _row(2, 71.9, False, market=74.2), _row(3, 75.1, True, market=71.7)]
    b = MR.block(rows, 0.536, 'test', {})
    assert b['n'] == 3 and b['n_picks'] == 2 and b['n_no_lean'] == 1
    assert b['correct'] == 1
    assert b['accuracy'] == 0.5
    assert b['by_model']['legacy']['correct'] == 1 and b['by_model']['legacy']['n_picks'] == 2
    assert b['by_model']['legacy']['accuracy'] == 0.5
    assert b['tiers'][0]['n'] == 0  # the 50.3 forecast is not in the 50-55 tier's record
    # Model and market on the same games: both give the coin flip half credit.
    assert b['baselines']['market']['accuracy'] == 0.5
    assert b['baselines']['market']['model_accuracy_same_games'] == 0.5


def test_coin_flip_band_leaves_brier_and_log_loss_alone():
    rows = [_row(1, 50.3, True, market=50.0), _row(2, 71.9, False, market=74.2), _row(3, 75.1, True, market=71.7)]
    b = MR.block(rows, 0.536, 'test', {})
    p = [0.503, 0.719, 0.751]
    y = [1, 0, 1]
    assert abs(b['brier'] - sum((pi - yi) ** 2 for pi, yi in zip(p, y)) / 3) < 1e-12
    assert abs(b['log_loss'] - MR._ll(y, p)) < 1e-12


def test_history_flags_coin_flips_as_no_lean():
    import generate_history as GH
    assert GH.is_lean(50.3) is False
    assert GH.is_lean(49.1) is False
    assert GH.is_lean(51.0) is True
    assert GH.is_lean(48.9) is True


def test_accuracy_all_sits_on_the_baselines_basis():
    """The pick record leaves coin flips out; accuracy_all keeps every game with a coin flip as half a
    pick, the basis the market and home-rate accuracy use, so a comparison table compares like with like."""
    rows = [_row(1, 50.3, True, market=60.0), _row(2, 71.9, False, market=74.2), _row(3, 75.1, True, market=71.7),
            _row(4, 64.0, True, market=58.0)]
    b = MR.block(rows, 0.536, 'test', {})
    assert b['accuracy'] == 2 / 3                      # pick record: 2-1, the coin flip left out
    assert b['accuracy_all'] == (2 + 0.5) / 4          # every game, the coin flip as half a pick
    assert b['accuracy_all'] == b['baselines']['market']['model_accuracy_same_games']
    assert b['by_model']['legacy']['accuracy_all'] == b['accuracy_all']
    assert MR.version_block([])['accuracy_all'] is None
