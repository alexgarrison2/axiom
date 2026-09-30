"""fix3-G5: game totals reach SiteHistory, including a day file written before
the total columns existed (2026-09-30's first two runs), so /api/odds-history
returns a total for every point captured after the upgrade."""
import csv
import datetime as dt

import snapshot_predictions as SP

UTC = dt.timezone.utc
TOTAL_COLS = ['total_line', 'total_over', 'total_under']
# predictions_detailed.csv columns the snapshot reads, totals included.
PRED_COLS = ['schema_version', 'nhl_game_id', 'game_id', 'game_date', 'start_time_utc', 'prediction_status',
             'home_team', 'away_team', 'model_version', 'home_model_win_pct', 'home_win_pct', 'away_win_pct',
             'home_blend_odds', 'away_blend_odds', 'home_vegas_odds', 'away_vegas_odds', 'home_vegas_win_pct',
             'home_ev', 'away_ev', 'wager_recommendation', 'home_xg', 'away_xg', 'home_starter', 'away_starter',
             *TOTAL_COLS]
# The exact header of public/data/SiteHistory/2026-09-30.csv before this fix.
PRE_TOTALS_HEADER = [c for c in SP.FIELDNAMES if c not in TOTAL_COLS]


def _pred(path, games):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=PRED_COLS)
        w.writeheader()
        for gid, key, start, home_odds, total in games:
            w.writerow({'schema_version': '2', 'nhl_game_id': gid, 'game_id': key, 'game_date': '2026-09-30',
                        'start_time_utc': start, 'prediction_status': 'pregame',
                        'home_team': key.split('-')[-1], 'away_team': key.split('-')[-2],
                        'model_version': 'logit-elo-test', 'home_model_win_pct': '38.9', 'home_win_pct': '51.4',
                        'away_win_pct': '48.6', 'home_blend_odds': '-106', 'away_blend_odds': '+106',
                        'home_vegas_odds': str(home_odds), 'away_vegas_odds': '+112', 'home_vegas_win_pct': '54.5',
                        'home_ev': '-0.09', 'away_ev': '0.02', 'wager_recommendation': 'No Bet',
                        'home_xg': '3.11', 'away_xg': '3.03', 'home_starter': 'Anthony Stolarz (Unconfirmed)',
                        'away_starter': 'Ilya Sorokin (Likely)',
                        'total_line': total[0], 'total_over': total[1], 'total_under': total[2]})


def _rows(path):
    with open(path) as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


NYI_TOR = ('2026020008', '2026-09-30-Islanders-Maple Leafs', '2026-09-30T23:30:00Z')


def test_fresh_day_file_has_total_columns_with_values(tmp_path):
    pred, hist = tmp_path / 'pred.csv', tmp_path / 'SiteHistory'
    _pred(pred, [(*NYI_TOR, -133, ('6.0', '-110', '-110')),
                 ('2026020007', '2026-09-30-Kings-Avalanche', '2026-10-01T02:00:00Z', -205, ('6.0', '-120', '100'))])
    SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 20, 0, tzinfo=UTC))

    header, rows = _rows(hist / '2026-09-30.csv')
    assert header == SP.FIELDNAMES
    assert set(TOTAL_COLS) <= set(header)
    by = {r['nhl_game_id']: r for r in rows}
    assert (by['2026020008']['total_line'], by['2026020008']['total_over'], by['2026020008']['total_under']) == ('6', '-110', '-110')
    assert (by['2026020007']['total_line'], by['2026020007']['total_over'], by['2026020007']['total_under']) == ('6', '-120', '+100')


def test_pre_totals_day_file_is_upgraded_and_next_run_adds_a_total_point(tmp_path):
    """Today's case: two runs were written before the total columns existed.
    The next run rewrites the header, leaves the old rows' totals blank (never
    invented), and appends a point with the total even though the moneyline
    did not move, so the line-move modal gets its TOTAL column."""
    pred, hist = tmp_path / 'pred.csv', tmp_path / 'SiteHistory'
    hist.mkdir()
    old = []
    for run, (stamp, ct, away, home) in enumerate([('2026-09-30T12:42:49Z', '07:42', '+110', '-130'),
                                                  ('2026-09-30T14:39:17Z', '09:39', '+112', '-133')], start=1):
        old.append({c: '' for c in PRE_TOTALS_HEADER} | {
            'date': '9/30/26', 'gameid': NYI_TOR[1], 'timestamp': ct, 'run': str(run), 'awayteam': 'Islanders',
            'away_starter': 'Sorokin (L)', 'away_xG': '3.03', 'away_win%': '48.6%', 'away_xGOdds': '+106',
            'away_Odds': away, 'away_EV': '+2.00', 'hometeam': 'Maple Leafs', 'home_starter': 'Stolarz (U)',
            'home_xG': '3.11', 'home_win%': '51.4%', 'home_xGOdds': '-106', 'home_Odds': home, 'home_EV': '-9.00',
            'timestamp_utc': stamp, 'model_version': 'logit-elo-test', 'home_model%': '38.9%',
            'home_market%': '54.5%', 'nhl_game_id': NYI_TOR[0]})
    with open(hist / '2026-09-30.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=PRE_TOTALS_HEADER)
        w.writeheader()
        w.writerows(old)

    _pred(pred, [(*NYI_TOR, -133, ('6.0', '-110', '-110'))])        # moneyline unchanged since run 2
    result = SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 20, 0, tzinfo=UTC))
    assert result == {'status': 'ok', 'rows_written': 1}

    header, rows = _rows(hist / '2026-09-30.csv')
    assert header == SP.FIELDNAMES
    assert [r['timestamp_utc'] for r in rows] == ['2026-09-30T12:42:49Z', '2026-09-30T14:39:17Z', '2026-09-30T20:00:00Z']
    assert [r['total_line'] for r in rows] == ['', '', '6']
    assert (rows[-1]['total_over'], rows[-1]['total_under']) == ('-110', '-110')
    assert [r['home_Odds'] for r in rows] == ['-130', '-133', '-133']

    # Same prices an hour later: nothing new.
    assert SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 21, 0, tzinfo=UTC))['rows_written'] == 0
    # The total moves: one more point.
    _pred(pred, [(*NYI_TOR, -133, ('5.5', '-135', '115'))])
    assert SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 22, 0, tzinfo=UTC))['rows_written'] == 1
    _, rows = _rows(hist / '2026-09-30.csv')
    assert [(r['total_line'], r['total_over'], r['total_under']) for r in rows[-2:]] == \
        [('6', '-110', '-110'), ('5.5', '-135', '+115')]


def test_missing_total_stays_blank(tmp_path):
    pred, hist = tmp_path / 'pred.csv', tmp_path / 'SiteHistory'
    _pred(pred, [(*NYI_TOR, -133, ('', '', ''))])
    SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 20, 0, tzinfo=UTC))
    _, rows = _rows(hist / '2026-09-30.csv')
    assert (rows[0]['total_line'], rows[0]['total_over'], rows[0]['total_under']) == ('', '', '')
