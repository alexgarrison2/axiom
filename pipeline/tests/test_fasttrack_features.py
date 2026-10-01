"""Fast track F1 (DESIGN §8 F1, §3.4, §3.7): lineup-quality delta and
starting-goalie swap features - maths, point-in-time (no leakage) asserts,
train/serve parity and the serving coverage gate."""
import os

import numpy as np
import pandas as pd
import pytest

import features as F
import lineup_adjust as L


# ─── synthetic fixtures ──────────────────────────────────────────────────────

def _mp(seasons=(2023, 2024)):
    """Two teams' worth of players with known on/off numbers."""
    rows = []
    for s in seasons:
        for pid in range(1, 61):
            pos = 'D' if pid % 3 == 0 else 'F'
            rel = 1.0 if pid == 1 else 0.0              # player 1 is a star (+1 xG/60 relative)
            toi5 = 60_000.0
            rows.append({'player_id': pid, 'season': s, 'name': f'Player {pid}', 'pos': pos, 'gp': 80,
                         'toi_all': 80 * 1000.0, 'toi5': toi5,
                         'on_f5': (2.5 + rel) * toi5 / 3600, 'on_a5': 2.5 * toi5 / 3600,
                         'off_f5': 2.5 * 200_000 / 3600, 'off_a5': 2.5 * 200_000 / 3600,
                         'bench5': 200_000.0, 'ixg_all': 10.0})
    return pd.DataFrame(rows, columns=L.MP_COLS)


def _store(n_days=12, star_out_day=None, season=2025):
    """Team AAA (players 1-18) hosts BBB (players 31-48) every day."""
    rows = []
    for d in range(n_days):
        date = pd.Timestamp(season, 10, 1) + pd.Timedelta(days=d)
        gid = int(f'{season}02{d + 1:04d}')
        home = list(range(1, 19))
        if star_out_day is not None and d >= star_out_day:
            home = [19] + list(range(2, 19))            # call-up 19 replaces the star
        for side, team, ids in (('H', 'AAA', home), ('A', 'BBB', list(range(31, 49)))):
            for pid in ids:
                pos = 'D' if pid % 3 == 0 else 'F'
                rows.append({'game_id': gid, 'game_date': date, 'side': side, 'team': team, 'player_id': pid,
                             'name': f'P. {pid}', 'sweater': pid, 'pos': pos,
                             'toi_sec': 1200 if pos == 'D' else 900, 'starter': False})
    return pd.DataFrame(rows, columns=L.LINEUP_COLS)


# ─── ratings ─────────────────────────────────────────────────────────────────

def test_ratings_use_only_completed_seasons():
    mp = _mp(seasons=(2023, 2024, 2025))
    r = L.player_ratings(mp, 2025)
    assert r['data_seasons'] == [2023, 2024]          # never 2025 itself
    assert r['asof'] == pd.Timestamp(2025, 7, 1)
    assert r['values'][1] > 0.4 and abs(r['values'][2]) < 1e-9
    # shrinkage: fewer minutes -> closer to 0
    mp2 = mp.copy()
    mp2.loc[mp2['player_id'] == 1, 'toi5'] /= 50
    mp2.loc[mp2['player_id'] == 1, ['on_f5', 'on_a5']] /= 50
    assert 0 < L.player_ratings(mp2, 2025)['values'][1] < r['values'][1]


def test_extract_mp_shape():
    raw = pd.DataFrame([
        {'playerId': 7, 'season': 2024, 'name': 'A B', 'team': 'X', 'position': 'D', 'situation': 'all',
         'games_played': 10, 'icetime': 12000, 'I_F_xGoals': 1.5, 'OnIce_F_xGoals': 9, 'OnIce_A_xGoals': 8,
         'OffIce_F_xGoals': 20, 'OffIce_A_xGoals': 20, 'timeOnBench': 30000},
        {'playerId': 7, 'season': 2024, 'name': 'A B', 'team': 'X', 'position': 'D', 'situation': '5on5',
         'games_played': 10, 'icetime': 9000, 'I_F_xGoals': 1.0, 'OnIce_F_xGoals': 6, 'OnIce_A_xGoals': 5,
         'OffIce_F_xGoals': 15, 'OffIce_A_xGoals': 16, 'timeOnBench': 25000},
    ])
    m = L.extract_mp(raw)
    assert list(m.columns) == L.MP_COLS and len(m) == 1
    r = m.iloc[0]
    assert r['pos'] == 'D' and r['toi5'] == 9000 and r['on_f5'] == 6 and r['bench5'] == 25000


# ─── lineup delta ────────────────────────────────────────────────────────────

def test_usual_lineup_is_neutral_and_a_missing_star_costs():
    M = L.build_lineup_matrix(_store(n_days=12, star_out_day=8), _mp(), cross_season=True)
    M = M.set_index('game_id')
    first = M.iloc[: L.MIN_BASELINE_GAMES]
    assert (~first['lineup_ok']).all() and (first['d_lineup'] == 0).all()   # no baseline yet
    usual = M.iloc[L.MIN_BASELINE_GAMES:8]
    assert usual['lineup_ok'].all() and np.allclose(usual['d_lineup'], 0.0)
    star_out = M.iloc[8]
    assert star_out['h_lineup_dq'] < -0.05 and star_out['d_lineup'] < -0.05
    assert abs(star_out['a_lineup_dq']) < 1e-12


def test_lineup_features_are_point_in_time():
    """Leakage assert: every feature row's ratings and lineup history predate the game."""
    M = L.build_lineup_matrix(_store(n_days=12, star_out_day=8), _mp(), cross_season=True)
    ok = M[M['lineup_ok']]
    assert len(ok) > 0
    assert (ok['ratings_asof'] < ok['game_date']).all()
    assert (ok['ratings_data_max_season'] < ok['season']).all()
    assert (pd.to_datetime(ok['history_max_date']) < ok['game_date']).all()


def test_tonight_cannot_see_its_own_game():
    """Changing a game's own lineup TOI must not change any feature of that date."""
    st = _store(n_days=10)
    a = L.build_lineup_matrix(st, _mp())
    st2 = st.copy()
    last = st2['game_id'] == st2['game_id'].max()
    st2.loc[last, 'toi_sec'] = 1
    b = L.build_lineup_matrix(st2, _mp())
    pd.testing.assert_series_equal(a['d_lineup'], b['d_lineup'])


def test_stored_lineups_are_point_in_time():
    """The same leakage assert on the real stored seasons (when present)."""
    store = L.load_lineup_store()
    if store.empty:
        pytest.skip('no stored lineups')
    M = L.build_lineup_matrix(store, L.load_mp())
    ok = M[M['lineup_ok']]
    assert len(ok) > 0.8 * len(M)
    assert (ok['ratings_asof'] < ok['game_date']).all()
    assert (ok['ratings_data_max_season'] < ok['season']).all()
    assert (pd.to_datetime(ok['history_max_date']) < ok['game_date']).all()


def test_train_serve_parity_lineup():
    """Serving replays the stored games before the date and must reproduce the training row."""
    store = _store(n_days=12, star_out_day=8)
    mp = _mp()
    M = L.build_lineup_matrix(store, mp).set_index('game_id')
    gid = int(store['game_id'].unique()[9])
    date = store.loc[store['game_id'] == gid, 'game_date'].iloc[0]
    st = L.LineupState(mp, cross_season=L.LINEUP_CROSS_SEASON)
    for _, day in store[store['game_date'] < date].groupby('game_date'):
        st.update_day(day)
    tonight = store[store['game_id'] == gid]
    home = [{'name': f'Player {p}', 'number': p} for p in tonight[tonight['side'] == 'H']['player_id']]
    away = [{'name': f'Player {p}', 'number': p} for p in tonight[tonight['side'] == 'A']['player_id']]
    lineup = lambda ps: {'f1': ps[:12], 'd1': ps[12:]}  # noqa: E731
    f = L.serve_lineup_features(st, 'AAA', 'BBB', date, lineup(home), lineup(away), season=2025)
    assert f['home']['source'] == 'projected' and f['home']['matched'] == 18
    assert abs(f['d_lineup'] - M.loc[gid, 'd_lineup']) < 1e-12


def test_serving_drops_injured_and_falls_back_to_last_lineup():
    store = _store(n_days=8)
    st = L.LineupState(_mp())
    for _, day in store.groupby('game_date'):
        st.update_day(day)
    ps = [{'name': f'Player {p}', 'number': p} for p in range(1, 19)]
    ids, info = L.serve_lineup_side(st, 'AAA', 2025, {'f1': ps}, injured=[{'name': 'Player 1', 'status': 'Out'}])
    assert 1 not in ids and info['source'] == 'projected'
    ps[1]['injuryStatus'] = 'ir'
    ids, _ = L.serve_lineup_side(st, 'AAA', 2025, {'f1': ps})
    assert 2 not in ids
    # coverage gate: unknown names -> the team's last dressed lineup (L-asof)
    junk = [{'name': f'Nobody {i}', 'number': 99} for i in range(18)]
    ids, info = L.serve_lineup_side(st, 'AAA', 2025, {'f1': junk})
    assert info['source'] == 'last_game' and ids == st.last_lineup('AAA')


def test_fetch_lineups_is_resumable(tmp_path):
    box = {'id': 2025020001, 'gameDate': '2025-10-07',
           'homeTeam': {'abbrev': 'AAA'}, 'awayTeam': {'abbrev': 'BBB'},
           'playerByGameStats': {
               'homeTeam': {'forwards': [{'playerId': i, 'name': {'default': f'P. {i}'}, 'sweaterNumber': i,
                                          'toi': '15:00'} for i in range(1, 13)],
                            'defense': [{'playerId': i, 'name': {'default': f'P. {i}'}, 'sweaterNumber': i,
                                         'toi': '20:30'} for i in range(13, 19)],
                            'goalies': [{'playerId': 30, 'name': {'default': 'G. A'}, 'sweaterNumber': 30,
                                         'toi': '60:00', 'starter': True}]},
               'awayTeam': {'forwards': [{'playerId': i, 'toi': '10:00'} for i in range(31, 43)],
                            'defense': [{'playerId': i, 'toi': '20:00'} for i in range(43, 49)],
                            'goalies': []}}}
    calls = []

    def getter(gid):
        calls.append(gid)
        return box
    assert L.fetch_lineups([2025020001], 2025, ft_dir=str(tmp_path), min_interval=0, getter=getter) == 1
    assert L.fetch_lineups([2025020001], 2025, ft_dir=str(tmp_path), min_interval=0, getter=getter) == 0
    assert calls == [2025020001]
    s = L.load_lineup_store(ft_dir=str(tmp_path))
    assert len(s) == 37 and s.loc[s['player_id'] == 13, 'toi_sec'].iloc[0] == 1230
    assert bool(s.loc[s['player_id'] == 30, 'starter'].iloc[0])


# ─── starting-goalie swap ────────────────────────────────────────────────────

def _goalie_games(starters_home, season=2025):
    rows = []
    for i, g in enumerate(starters_home):
        d = pd.Timestamp(season, 10, 1) + pd.Timedelta(days=2 * i)
        gid = int(f'{season}02{i + 1:04d}')
        for ha, team, opp, sg, xga, ga in (('Home', 'Bruins', 'Rangers', g, 3.0, 1 if g == 'Good Starter' else 5),
                                          ('Away', 'Rangers', 'Bruins', 'Other Goalie', 3.0, 3)):
            rows.append({'game_id': gid, 'game_date': d, 'season': season, 'team': team, 'opponent': opp,
                         'home_away': ha, 'result': 'W' if ha == 'Home' else 'L', 'goals_for': 3, 'goals_ag': 2,
                         'starting_goalie': sg, 'rxgf_all': 3.0, 'rxga_all': xga, 'rxgf_5v5': 2.0,
                         'rxga_5v5': 2.0, 'ga_noen': ga})
    return pd.DataFrame(rows)


def test_goalie_swap_fires_only_on_a_goalie_change():
    g = _goalie_games(['Good Starter'] * 8 + ['Weak Backup'] * 2)
    st = F.build_state(g)
    same = st.pregame('Bruins', 'Rangers', '2025-11-01', 'Good Starter', 'Other Goalie')
    assert same['h_goalie_swap'] == 0.0 and same['a_goalie_swap'] == 0.0
    swap = st.pregame('Bruins', 'Rangers', '2025-11-01', 'Weak Backup', 'Other Goalie')
    assert swap['h_goalie_swap'] < 0 and swap['d_goalie_swap'] < 0
    assert abs(swap['h_goalie_swap'] - (swap['h_goalie_gsax'] - st.goalie_rating('Good Starter')[0])) < 1e-12
    unknown = st.pregame('Bruins', 'Rangers', '2025-11-01', 'Never Seen', 'Other Goalie')
    assert unknown['h_goalie_swap'] == 0.0


def test_goalie_swap_is_point_in_time(feature_games, training_matrix):
    """Training rows equal a serving call on the history before the date (goalie swap included)."""
    rng = np.random.default_rng(3)
    M = training_matrix[training_matrix['season'] >= 2024]
    for i in rng.choice(len(M), 10, replace=False):
        r = M.iloc[i]
        st = F.build_state(feature_games, before_date=r['game_date'])
        f = st.pregame(r['home'], r['away'], r['game_date'], r['h_goalie'], r['a_goalie'], season=int(r['season']))
        assert abs(f['d_goalie_swap'] - r['d_goalie_swap']) < 1e-9


def test_ml_predictor_serves_the_lineup_goalie_factor(tmp_path, training_matrix):
    """A model trained with the F1 columns: the lineup delta enters through
    extra_features and the 'lineup_goalie' factor carries its logit."""
    import math

    import train_game_model as T
    from ml_predict import MLPredictor
    rng = np.random.default_rng(0)
    M = training_matrix[training_matrix['season'] >= 2023].copy()
    M['d_lineup'] = rng.normal(0, 0.2, len(M))
    cols = list(F.FEATURE_COLUMNS) + ['d_goalie_swap', 'd_lineup']
    m = T.fit_logit(M, cols, 0.01)
    betas, home = T.explain_coefficients(m, cols)
    meta = {'model_version': 'test-ft', 'feature_columns': cols, 'coefficients_raw': betas,
            'home_ice_logit': home, 'fasttrack': {'lineup_cross_season': True, 'rating_value': 'rel5'}}
    T.save_model(m, meta, model_path=str(tmp_path / 'm.pkl'), meta_path=str(tmp_path / 'm.json'))
    ml = MLPredictor(pd.DataFrame(), model_path=str(tmp_path / 'm.pkl'), meta_path=str(tmp_path / 'm.json'))
    assert ml.uses_lineups
    d0 = ml.predict_detail('Kings', 'Ducks', '2026-10-03', extra_features={'d_lineup': 0.0})
    d1 = ml.predict_detail('Kings', 'Ducks', '2026-10-03', extra_features={'d_lineup': 0.5})
    t0 = {t['factor']: t['logit'] for t in d0['logit_terms']}
    t1 = {t['factor']: t['logit'] for t in d1['logit_terms']}
    assert 'lineup_goalie' in t1 and 'lineup' not in t1
    assert abs((t1['lineup_goalie'] - t0['lineup_goalie']) - 0.5 * betas['d_lineup']) < 1e-9
    p = d1['model_prob_raw']
    assert abs(sum(t1.values()) - math.log(p / (1 - p))) < 1e-9


def test_incumbent_model_keeps_its_factor_list():
    from ml_predict import MLPredictor
    ml = MLPredictor(pd.DataFrame())
    if any(c in ml.feature_cols for c in ('d_lineup', 'd_goalie_swap')):
        pytest.skip('live model is the fast-track model')
    d = ml.predict_detail('Kings', 'Ducks', '2026-10-03')
    assert 'lineup_goalie' not in {t['factor'] for t in d['logit_terms']}
    assert not ml.uses_lineups


def test_stored_files_are_small():
    for fn in os.listdir(L.FT_DIR) if os.path.isdir(L.FT_DIR) else []:
        assert os.path.getsize(os.path.join(L.FT_DIR, fn)) < 3_000_000, fn


# ─── review fixes ────────────────────────────────────────────────────────────

def test_unmapped_projected_player_dresses_as_an_unrated_debut():
    """A projected player with no NHL id (call-up / debut) is scored like a
    debut in training (position's unrated value, default TOI), not dropped."""
    store = _store(n_days=8)
    mp = _mp()
    st = L.LineupState(mp)
    for _, day in store.groupby('game_date'):
        st.update_day(day)
    # training: the usual 18 minus the star, plus debut 99 (a D-man with no history)
    tr = store[store['game_id'] == store['game_id'].max()].copy()
    tr = tr[tr['player_id'] != 1]
    debut = tr[(tr['side'] == 'H')].iloc[[0]].assign(player_id=99, name='P. 99', sweater=99, pos='D', toi_sec=1200)
    tr = pd.concat([tr, debut], ignore_index=True)
    tr['game_date'] = tr['game_date'] + pd.Timedelta(days=1)
    tr['game_id'] = tr['game_id'] + 1
    M = L.build_lineup_matrix(pd.concat([store, tr], ignore_index=True), mp).set_index('game_id')
    want = M.loc[int(tr['game_id'].iloc[0]), 'd_lineup']
    assert want < 0
    # serving: same lineup from DailyFaceoff, the debut unknown by name/number, listed on a D pair
    fwd = [{'name': f'Player {p}', 'number': p} for p in range(2, 19) if p % 3]
    dmen = [{'name': f'Player {p}', 'number': p} for p in range(2, 19) if not p % 3] + \
        [{'name': 'Brand New', 'number': 99}]
    away = [{'name': f'Player {p}', 'number': p} for p in range(31, 49)]
    f = L.serve_lineup_features(st, 'AAA', 'BBB', tr['game_date'].iloc[0], {'f1': fwd, 'd1': dmen},
                                {'f1': away}, season=2025)
    assert f['home']['source'] == 'projected' and f['home']['matched'] == 17
    assert f['home']['unknown'] == ['Brand New'] and 'placeholder_pos' not in f['home']
    assert abs(f['d_lineup'] - want) < 1e-12


def test_debut_position_comes_from_the_boxscore_in_training():
    store = _store(n_days=8)
    last = store['game_id'] == store['game_id'].max()
    store.loc[last & (store['player_id'] == 3), 'player_id'] = 77      # a debut D-man replaces D 3
    st = L.LineupState(_mp())
    for _, day in store[~last].groupby('game_date'):
        st.update_day(day)
    assert st.pos_of(77) == 'F'                     # nothing known before his debut
    M = L.build_lineup_matrix(store, _mp()).set_index('game_id')
    ids = list(store.loc[last & (store['side'] == 'H'), 'player_id'])
    s = st.side('AAA', 2025, ids, {77: 'D'})
    assert abs(M.loc[int(store.loc[last, 'game_id'].iloc[0]), 'h_lineup_dq'] - s['dq']) < 1e-12


def test_lineup_state_loads_lazily(tmp_path, training_matrix, monkeypatch):
    import ml_predict
    import train_game_model as T
    calls = []
    monkeypatch.setattr(ml_predict, 'load_lineup_state', lambda meta=None: calls.append(1) or 'STATE')
    M = training_matrix[training_matrix['season'] >= 2024].copy()
    M['d_lineup'] = 0.0
    M.loc[M.index[::2], 'd_lineup'] = 0.1
    cols = list(F.FEATURE_COLUMNS) + ['d_lineup']
    m = T.fit_logit(M, cols, 0.01)
    betas, home = T.explain_coefficients(m, cols)
    T.save_model(m, {'model_version': 't', 'feature_columns': cols, 'coefficients_raw': betas,
                     'home_ice_logit': home}, model_path=str(tmp_path / 'm.pkl'), meta_path=str(tmp_path / 'm.json'))
    ml = ml_predict.MLPredictor(pd.DataFrame(), model_path=str(tmp_path / 'm.pkl'), meta_path=str(tmp_path / 'm.json'))
    assert ml.uses_lineups and calls == []          # constructing it does not replay the store
    ml.predict_detail('Kings', 'Ducks', '2026-10-03')
    assert calls == []
    assert ml.lineup_state == 'STATE' and ml.lineup_state == 'STATE' and calls == [1]
    off = ml_predict.MLPredictor(pd.DataFrame(), model_path=str(tmp_path / 'missing.pkl'))
    assert not off.uses_lineups and off.lineup_state is None


def test_plain_retrain_keeps_the_live_feature_set(tmp_path):
    import json

    import train_game_model as T
    meta = {'feature_columns': list(F.FEATURE_COLUMNS) + ['d_lineup'],
            'fasttrack': {'gate_passed': True, 'candidate': 'lineup', 'lineup_cross_season': True}}
    p = tmp_path / 'meta.json'
    p.write_text(json.dumps(meta))
    cols, cur = T.live_feature_columns(str(p))
    assert cols == meta['feature_columns']
    ft = T.fasttrack_config(cols, cur)
    assert ft['gate_passed'] is True and ft['candidate'] == 'lineup'
    assert ft['lineup_cross_season'] == L.LINEUP_CROSS_SEASON and ft['rating_value'] == L.RATING_VALUE
    assert T.fasttrack_config(list(F.FEATURE_COLUMNS), cur) is None
    assert T.live_feature_columns(str(tmp_path / 'none.json'))[0] == list(F.FEATURE_COLUMNS)


def test_first_lookup_of_a_run_can_use_rating_names():
    """A fresh LineupState (first game of a predict run) must still resolve a
    player by his full name when his sweater/team key is unknown (offseason
    move): resolve() needs the season's ratings loaded first."""
    store = _store(n_days=8)
    mp = _mp()
    st = L.LineupState(mp)
    for _, day in store.groupby('game_date'):
        st.update_day(day)
    assert st.r is None
    # 18 regulars with their numbers, plus nothing else: player 2 listed under a new number
    ps = [{'name': f'Player {p}', 'number': p if p != 2 else 66} for p in range(1, 19)]
    ids, info = L.serve_lineup_side(st, 'AAA', 2025, {'f1': ps})
    assert info['matched'] == 18 and 2 in ids and info['unknown'] == []
