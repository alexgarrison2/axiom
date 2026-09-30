"""C3: honest prediction history (live snapshots only) and a clean 2026-27 start."""
import json
import os

import pandas as pd
import pytest

import generate_history as GH
import site_history as S


@pytest.fixture(scope='module')
def history():
    with open(GH.HISTORY_PATH) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def keyed_site_history():
    sh, _ = S.load_keyed_site_history(allow_fetch=False)
    return sh


def test_every_live_row_has_a_pregame_snapshot(history, keyed_site_history):
    pre = S.pregame(keyed_site_history)
    first_snap = pre.groupby('game_id')['snapshot_utc'].min()
    live = [r for r in history if not r['retro']]
    assert len(live) >= 400
    for r in live:
        gid = r['gameId']
        assert gid in first_snap.index, gid
        assert pd.Timestamp(r['snapshotUtc']) < pd.Timestamp(r['startUtc']), gid


def test_no_non_nhl_teams(history):
    teams = set(pd.read_csv(GH.TEAMS_CSV)['Common Name'])
    bad = [r for r in history if r['homeTeam'] not in teams or r['awayTeam'] not in teams]
    assert len(bad) == 0
    assert {r['gameType'] for r in history} <= {'02', '03'}


def test_shootout_final_score(history):
    r = [x for x in history if x['date'] == '2025-10-28' and x['homeTeam'] == 'Flyers' and x['awayTeam'] == 'Penguins']
    assert len(r) == 1
    r = r[0]
    assert (r['homeScore'], r['awayScore'], r['decision'], r['actualWinner']) == (3, 2, 'SO', 'Flyers')


def test_keyed_by_unique_game_id(history):
    ids = [r['gameId'] for r in history]
    assert len(ids) == len(set(ids))
    assert all(len(str(i)) == 10 for i in ids)


def test_2026_27_clean_start_excludes_postdrop_games(monkeypatch):
    """Simulate tonight's results arriving: 2026020001-2 (predicted after puck drop)
    stay out; the pregame-snapshotted games are graded; no retro rows appear."""
    real = GH.load_results()
    fake = pd.DataFrame([
        {'game_id': 2026020001, 'date': '2026-09-29', 'home': 'Hurricanes', 'away': 'Panthers',
         'home_score': 0, 'away_score': 1, 'decision': 'OT', 'home_won': False, 'result': 'OTL'},
        {'game_id': 2026020002, 'date': '2026-09-29', 'home': 'Maple Leafs', 'away': 'Canadiens',
         'home_score': 3, 'away_score': 2, 'decision': 'REG', 'home_won': True, 'result': 'RW'},
        {'game_id': 2026020003, 'date': '2026-09-29', 'home': 'Bruins', 'away': 'Rangers',
         'home_score': 2, 'away_score': 4, 'decision': 'REG', 'home_won': False, 'result': 'RL'},
    ])
    monkeypatch.setattr(GH, 'load_results', lambda: pd.concat([real, fake], ignore_index=True))
    out = GH.generate_history(allow_fetch=False, write=False, verbose=False)
    new = [r for r in out if r['season'] == '2026-27']
    ids = {r['gameId'] for r in new}
    assert 2026020001 not in ids and 2026020002 not in ids
    assert 2026020003 in ids
    assert all(not r['retro'] for r in new)
