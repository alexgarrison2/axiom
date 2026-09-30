"""C6: leakage and drift fixes - goalie GSAx, special teams, shooting talent."""
import copy
import os

import numpy as np
import pandas as pd
import pytest

import features as F
import shooting_talent as ST
import team_ratings as TR

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope='module')
def state(feature_games):
    st = F.build_state(feature_games)
    st.ensure_season_for_date(None, season=int(feature_games['season'].max()) + 1)
    return st


def test_goalie_gsax_mean_is_zero_within_each_season(state):
    for season in (2022, 2023, 2024, 2025):
        xga = ga = gp = 0.0
        for by in state.goalies.values():
            g = by.get(season)
            if g:
                xga += g.xga * state.season_factor(season)
                ga += g.ga
                gp += g.gp
        assert gp > 2000
        assert abs((xga - ga) / gp) <= 0.02, season


def test_one_start_moves_rating_at_most_0_3(state):
    season = state.season
    moved = []
    for name, by in list(state.goalies.items()):
        prev = by.get(season - 1)
        if not prev or prev.gp < 20:
            continue
        before = state.goalie_rating(name, season)[0]
        for xga, ga in ((0.8, 7.0), (5.0, 0.0)):       # a shelling and a shutout steal
            st = copy.copy(state)
            st.goalies = dict(state.goalies)
            st.goalies[name] = dict(by)
            st.goalies[name][season] = F.GoalieSeason(xga=xga / st.season_factor(season), ga=ga, gp=1)
            moved.append(abs(st.goalie_rating(name, season)[0] - before))
    assert moved and max(moved) <= 0.3


def test_goalie_rows_use_nhl_games_only(feature_games):
    assert set(feature_games['game_id'].astype(str).str[4:6]) <= {'02', '03'}
    raw = pd.read_csv(os.path.join(PIPELINE_DIR, 'nhl_historical_gamestats.csv'), low_memory=False)
    gt = raw['game_id'].astype(str).str[4:6]
    odd = raw[gt.isin(['04', '12', '19', '20'])]
    assert len(odd) > 0            # the file does contain All-Star / PWHL / 4 Nations rows
    st = F.build_state(feature_games)
    nhl = raw[gt.isin(['02', '03'])].drop_duplicates(['game_id', 'team'])
    checked = 0
    for g in odd['starting_goalie'].dropna().unique():
        if g not in st.goalies:
            continue
        for season, gs in st.goalies[g].items():
            n = int(((nhl['starting_goalie'] == g) & (nhl['game_id'].map(F.season_of) == season)).sum())
            if n:
                assert gs.gp <= n
                checked += 1
    assert checked > 0
    # 4 Nations / PWHL-only names never get a rating
    ratings = TR.compute_goalie_ratings()
    nhl_names = set(nhl['starting_goalie'].dropna())
    assert set(ratings) <= nhl_names


def _one_game_df(feature_games, pp_goals=1, pp_opps=2):
    last = feature_games[feature_games['season'] == feature_games['season'].max()]
    gid = last['game_id'].iloc[-1]
    rows = last[last['game_id'] == gid].copy()
    rows['game_id'] = 2026020999
    rows['game_date'] = pd.Timestamp('2026-10-01')
    home = rows['home_away'] == 'Home'
    rows.loc[home, ['pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities']] = [pp_goals, pp_opps, 0, 3]
    rows.loc[~home, ['pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities']] = [0, 3, pp_goals, pp_opps]
    return rows, rows.loc[home, 'team'].iloc[0]


def test_pp_rating_is_regressed_after_one_game(feature_games):
    df, team = _one_game_df(feature_games)
    tr, _, _, _ = TR.calculate_ratings(df=df, save_files=False)
    t = tr[team]
    assert t['pp_pct_actual'] == 50.0 and t['pp_opportunities'] == 2
    assert abs(t['pp_rating'] - t['league_pp_pct']) <= 3.0
    assert t['pp_rating'] != 50.0


def test_shooting_talent_uses_prior_seasons_only():
    shots = pd.DataFrame({
        'game_id': [2024020001] * 50 + [2025020001] * 50,
        'player_id': [1] * 100,
        'is_goal': [1] * 10 + [0] * 40 + [1] * 40 + [0] * 10,     # 2025: absurd finishing
        'xg_raw': [0.1] * 100,
        'strength_state': ['5v5'] * 100,
    })
    t = ST.talent_table(shots, [2025, 2026]).set_index('season')
    # the 2025 multiplier must not see the 2025 goals (40 on 5 xG)
    assert t.loc[2025, 'goals'] == pytest.approx(0.5 * 10)
    assert t.loc[2026, 'goals'] == pytest.approx(0.5 * 40 + 0.3 * 10)


def test_apply_shooting_talent_keeps_xg_raw():
    df = pd.DataFrame({'game_id': [2026020001, 2026020001], 'player_id': [1, 2], 'xG': [0.2, 0.1]})
    out = ST.apply_shooting_talent(df.copy(), {2026: {1: 1.3}})
    assert list(out['xG']) == [0.2, 0.1] and list(out['xg_raw']) == [0.2, 0.1]
    assert list(ST.talent_multipliers(out, {2026: {1: 1.3}})) == [1.3, 1.0]
