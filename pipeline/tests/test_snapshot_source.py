"""fix4 F4-8: each SiteHistory snapshot records the book its moneyline came from,
so the line-move modal can tell a Bovada -> DraftKings switch from a market move."""
import csv
import datetime as dt

import snapshot_predictions as SP
from tools import backfill_snapshot_source as BF

UTC = dt.timezone.utc
COLS = ['schema_version', 'nhl_game_id', 'game_id', 'game_date', 'start_time_utc', 'prediction_status',
        'home_team', 'away_team', 'model_version', 'home_model_win_pct', 'home_win_pct', 'away_win_pct',
        'home_blend_odds', 'away_blend_odds', 'home_vegas_odds', 'away_vegas_odds', 'home_vegas_win_pct',
        'home_ev', 'away_ev', 'wager_recommendation', 'home_xg', 'away_xg', 'home_starter', 'away_starter',
        'total_line', 'total_over', 'total_under', 'market_source']
KEY = '2026-09-30-Islanders-Maple Leafs'


def _pred(path, source, home_odds=-130, away_odds=110):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerow({'schema_version': '2', 'nhl_game_id': '2026020008', 'game_id': KEY, 'game_date': '2026-09-30',
                    'start_time_utc': '2026-09-30T23:30:00Z', 'prediction_status': 'pregame',
                    'home_team': 'Maple Leafs', 'away_team': 'Islanders', 'model_version': 'logit-elo-test',
                    'home_model_win_pct': '38.9', 'home_win_pct': '51.4', 'away_win_pct': '48.6',
                    'home_blend_odds': '-106', 'away_blend_odds': '+106', 'home_vegas_odds': str(home_odds),
                    'away_vegas_odds': str(away_odds), 'home_vegas_win_pct': '54.5', 'home_ev': '-0.09',
                    'away_ev': '0.02', 'wager_recommendation': 'No Bet', 'home_xg': '3.11', 'away_xg': '3.03',
                    'home_starter': 'Anthony Stolarz (Unconfirmed)', 'away_starter': 'Ilya Sorokin (Likely)',
                    'total_line': '5.5', 'total_over': '-135', 'total_under': '114', 'market_source': source})


def _rows(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def test_snapshot_records_the_book_and_a_switch_is_a_new_point(tmp_path):
    pred, hist = tmp_path / 'pred.csv', tmp_path / 'SiteHistory'
    _pred(pred, 'bovada')
    SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 14, 0, tzinfo=UTC))
    assert [r['market_source'] for r in _rows(hist / '2026-09-30.csv')] == ['bovada']
    # Same prices from another book: a new snapshot, so the switch is visible.
    _pred(pred, 'nhl_partner_draftkings')
    assert SP.snapshot(str(pred), str(hist), dt.datetime(2026, 9, 30, 20, 0, tzinfo=UTC))['rows_written'] == 1
    assert [r['market_source'] for r in _rows(hist / '2026-09-30.csv')] == ['bovada', 'nhl_partner_draftkings']


def test_backfill_matches_game_price_and_fetch_time_and_never_guesses(tmp_path):
    hist = tmp_path
    header = [c for c in SP.FIELDNAMES if c != 'market_source']
    rows = [
        {'gameid': KEY, 'run': '1', 'timestamp_utc': '2026-09-30T12:42:49Z', 'away_Odds': '+110', 'home_Odds': '-130'},
        {'gameid': KEY, 'run': '2', 'timestamp_utc': '2026-09-30T14:39:17Z', 'away_Odds': '+112', 'home_Odds': '-133'},
        {'gameid': KEY, 'run': '3', 'timestamp_utc': '2026-09-30T20:10:37Z', 'away_Odds': '+110', 'home_Odds': '-130'},
        # No committed quote with this price: stays blank.
        {'gameid': KEY, 'run': '4', 'timestamp_utc': '2026-09-30T21:10:37Z', 'away_Odds': '+140', 'home_Odds': '-160'},
    ]
    with open(hist / '2026-09-30.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({c: '' for c in header} | r)
    at = BF._ts
    quotes = [
        {'gameid': KEY, 'source': 'bovada', 'at': at('2026-09-30T12:42:12Z'), 'away': 110, 'home': -130},
        {'gameid': KEY, 'source': 'bovada', 'at': at('2026-09-30T14:39:04Z'), 'away': 112, 'home': -133},
        {'gameid': KEY, 'source': 'nhl_partner_draftkings', 'at': at('2026-09-30T20:10:15Z'), 'away': 110, 'home': -130},
    ]
    assert BF.backfill('2026-09-30', quotes=quotes, history_dir=str(hist)) == 3
    out = _rows(hist / '2026-09-30.csv')
    assert [r['market_source'] for r in out] == ['bovada', 'bovada', 'nhl_partner_draftkings', '']
    assert list(out[0].keys()) == SP.FIELDNAMES
