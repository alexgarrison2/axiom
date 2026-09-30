"""C1/C6: shared feature builder - train/serve parity and data hygiene."""
import numpy as np
import pandas as pd

import features as F


def test_only_nhl_game_types(feature_games):
    types = set(feature_games['game_id'].astype(str).str[4:6])
    assert types <= {'02', '03'}, types
    assert not feature_games['team'].isin(['Canada', 'USA', 'Sweden', 'Finland', 'Team McDavid', 'Team Kloss']).any()


def test_train_serve_parity_50_games(feature_games, training_matrix):
    """Serving features (state rebuilt from history strictly before the game date)
    equal the training-matrix row for 50 random past games, to 1e-9."""
    rng = np.random.default_rng(20260929)
    M = training_matrix[training_matrix['season'] >= 2023]
    sample = M.iloc[rng.choice(len(M), 50, replace=False)]
    cols = F.FEATURE_COLUMNS + F.CANDIDATE_COLUMNS + ['league_gpg', 'pace', 'norm_factor']
    for _, row in sample.iterrows():
        served = F.build_pregame_features(feature_games, row['home'], row['away'], row['game_date'],
                                          row['h_goalie'], row['a_goalie'])
        for c in cols:
            assert abs(served[c] - row[c]) <= 1e-9, (row['game_id'], c, served[c], row[c])


def test_games_played_counts_completed_games(training_matrix):
    """games played before a team's first game of a season is 0 (no off-by-one)."""
    M = training_matrix.sort_values('game_date')
    long = pd.concat([
        M[['season', 'game_date', 'home', 'h_gp', 'team_game_number_h']].set_axis(['season', 'date', 'team', 'gp', 'num'], axis=1),
        M[['season', 'game_date', 'away', 'a_gp', 'team_game_number_a']].set_axis(['season', 'date', 'team', 'gp', 'num'], axis=1),
    ]).sort_values('date', kind='stable')
    first = long.groupby(['season', 'team']).head(1)
    assert (first['gp'] == 0).all()
    assert (first['num'] == 1).all()


def test_offseason_regression_toward_mean():
    st = F.FeatureState()
    st.season = 2025
    t = st._team('Oilers')
    t.xg_share, t.elo = 0.56, 1600.0
    st.start_season(2026)
    assert abs(t.xg_share - (0.5 + F.OFFSEASON_KEEP * 0.06)) < 1e-12
    assert abs(t.elo - (1500 + (1 - F.ELO_OFFSEASON_REGRESSION) * 100)) < 1e-12


def test_shrunk_points_pct_at_zero_gp():
    st = F.FeatureState()
    f = st.pregame('Oilers', 'Canucks', '2026-09-29')
    assert f['h_pts_pct'] == 0.5 and f['a_pts_pct'] == 0.5 and f['d_pts_pct'] == 0.0


def test_goalie_one_start_moves_rating_little(feature_games):
    """C6: one current-season start moves a veteran <= 0.3 GSAx/gm."""
    st = F.build_state(feature_games)
    st.ensure_season_for_date('2026-10-01')
    name = 'Tristan Jarry'
    by = st.goalies[name]
    by.pop(st.season, None)       # drop any real current-season line so the baseline is 0 GP
    before, _, gp0 = st.goalie_rating(name)
    assert gp0 == 0
    by[st.season] = F.GoalieSeason(xga=1.0, ga=6.0, gp=1)   # a -5 GSAx disaster
    after, _, gp1 = st.goalie_rating(name)
    assert gp1 == 1
    assert abs(after - before) <= 0.3, (before, after)


def test_goalie_name_resolution():
    st = F.FeatureState()
    st.goalies['Leevi Meriläinen'] = {2025: F.GoalieSeason(10, 8, 5)}
    assert st.resolve_goalie('Leevi Merilainen') == 'Leevi Meriläinen'
    assert st.resolve_goalie('L. Merilainen') == 'Leevi Meriläinen'
    assert st.resolve_goalie('Nobody Here') is None
