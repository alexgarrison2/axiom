"""SiteHistory snapshot writer (fix1-G1 G1-5): one timestamped pregame row per
changed game per run, no blank separator rows, nothing after puck drop."""
import csv
import datetime as dt

import snapshot_predictions as SP
import site_history as S

UTC = dt.timezone.utc
COLS = ['schema_version', 'nhl_game_id', 'game_id', 'game_date', 'start_time_utc', 'prediction_status',
        'home_team', 'away_team', 'model_version', 'home_model_win_pct', 'home_win_pct', 'away_win_pct',
        'home_blend_odds', 'away_blend_odds', 'home_model_odds', 'away_model_odds',
        'home_vegas_odds', 'away_vegas_odds', 'home_vegas_win_pct', 'home_ev', 'away_ev',
        'wager_recommendation', 'home_xg', 'away_xg', 'home_starter', 'away_starter']


def _game(gid, key, start, home_odds, status='pregame'):
    return {'schema_version': '2', 'nhl_game_id': gid, 'game_id': key, 'game_date': '2026-10-01',
            'start_time_utc': start, 'prediction_status': status, 'home_team': key.split('-')[-1],
            'away_team': key.split('-')[-2], 'model_version': 'logit-elo-test', 'home_model_win_pct': '52.0',
            'home_win_pct': '55.0', 'away_win_pct': '45.0', 'home_blend_odds': '-122', 'away_blend_odds': '+122',
            'home_model_odds': '-108', 'away_model_odds': '+108', 'home_vegas_odds': str(home_odds),
            'away_vegas_odds': '+110', 'home_vegas_win_pct': '54.0', 'home_ev': '0.01', 'away_ev': '-0.02',
            'wager_recommendation': 'No Bet', 'home_xg': '3.1', 'away_xg': '2.8',
            'home_starter': 'A Goalie (Confirmed)', 'away_starter': 'B Goalie (Likely)'}


def _write(path, rows):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)


def test_two_runs_with_price_change_give_two_points(tmp_path):
    pred = tmp_path / 'pred.csv'
    hist = tmp_path / 'SiteHistory'
    a = ('2026020010', '2026-10-01-Flyers-Devils', '2026-10-01T23:00:00Z')
    b = ('2026020011', '2026-10-01-Wild-Predators', '2026-10-02T00:00:00Z')
    started = ('2026020012', '2026-10-01-Kraken-Flames', '2026-10-01T16:00:00Z')
    run1 = dt.datetime(2026, 10, 1, 17, 0, tzinfo=UTC)
    run2 = dt.datetime(2026, 10, 1, 18, 0, tzinfo=UTC)
    run3 = dt.datetime(2026, 10, 1, 19, 0, tzinfo=UTC)
    _write(pred, [_game(*a, -130), _game(*b, -120), _game(*started, -150, status='frozen')])
    SP.snapshot(str(pred), str(hist), run1)
    _write(pred, [_game(*a, -140), _game(*b, -120), _game(*started, -150, status='frozen')])  # a's price moved
    SP.snapshot(str(pred), str(hist), run2)
    SP.snapshot(str(pred), str(hist), run3)                                                   # nothing changed

    text = (hist / '2026-10-01.csv').read_text()
    assert ',,,,' not in text
    rows = list(csv.DictReader(text.splitlines()))
    by = {}
    for r in rows:
        by.setdefault(r['nhl_game_id'], []).append(r)
    assert len(by['2026020010']) == 2 and [r['home_Odds'] for r in by['2026020010']] == ['-130', '-140']
    assert [r['timestamp_utc'] for r in by['2026020010']] == ['2026-10-01T17:00:00Z', '2026-10-01T18:00:00Z']
    assert len(by['2026020011']) == 1          # unchanged game: one point
    assert '2026020012' not in by              # started (frozen) game: never snapshotted
    assert by['2026020010'][0]['home_xGOdds'] == '-122'   # fair line of the published %

    sh = S.load_site_history(str(hist))
    assert set(sh['nhl_game_id']) == {'2026020010', '2026020011'}


def test_legacy_file_gets_ids_backfilled_and_separators_dropped(tmp_path):
    """A day file written before nhl_game_id existed (with ',,,' separator rows)
    is upgraded on the next write, so /api/odds-history finds its first point."""
    pred = tmp_path / 'pred.csv'
    hist = tmp_path / 'SiteHistory'
    hist.mkdir()
    legacy_cols = [c for c in SP.FIELDNAMES if c != 'nhl_game_id']
    old = {c: '' for c in legacy_cols}
    old.update({'date': '10/1/26', 'gameid': '2026-10-01-Flyers-Devils', 'timestamp': '11:00', 'run': '1',
                'awayteam': 'Flyers', 'hometeam': 'Devils', 'away_Odds': '+110', 'home_Odds': '-125',
                'timestamp_utc': '2026-10-01T16:00:00Z'})
    with open(hist / '2026-10-01.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=legacy_cols)
        w.writeheader()
        w.writerow(old)
        f.write(',' * (len(legacy_cols) - 1) + '\n')
    _write(pred, [_game('2026020010', '2026-10-01-Flyers-Devils', '2026-10-01T23:00:00Z', -140)])
    SP.snapshot(str(pred), str(hist), dt.datetime(2026, 10, 1, 17, 0, tzinfo=UTC))

    text = (hist / '2026-10-01.csv').read_text()
    assert not any(set(line) <= {','} for line in text.splitlines())   # no blank separator rows
    rows = list(csv.DictReader(text.splitlines()))
    assert [r['nhl_game_id'] for r in rows] == ['2026020010', '2026020010']
    assert [r['home_Odds'] for r in rows] == ['-125', '-140']
