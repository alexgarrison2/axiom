"""
pony_score_calibrate.py

Measures the constants behind the Pony Score (the per-game player score on
/games/[id]) from our own data, so no part of it is borrowed from another
public index. Writes public/data/pony_score.json; the game page imports it.

Data: the local lake (data/lake/parquet: events, lineups) for the last three
regular seasons, with pony xG joined from pipeline/nhl_historical_shots.csv
by (game_id, event_id); IMPACT ratings from public/data/player_ratings.json.

Measured:
  k              league goals per pony xG (unblocked, non-shootout attempts)
  ev_xg60        league 5v5 xG per 60 for one team (the play-driving baseline)
  pp_xg60        league 5v4 xG per 60 for the team on the power play (special-teams baseline)
  pen_value      net goals of a power play per two penalty minutes it gives the
                 other team (PP goals for minus SH goals against while 5v4 / 5v3,
                 per PP-team opportunity, scaled to a two-minute minor)
  fo_end, fo_neutral
                 goals a faceoff win is worth against a coin flip: the winner's
                 net pony xG over the next 20 seconds (5v5, cut at the next
                 faceoff or period end), half the win-minus-loss gap; end-zone
                 draws pool the offensive and defensive views (symmetric)
  block_xg       mean pony xG of 5v5 unblocked attempts by distance band: the
                 value of a blocked attempt from that far out
  prod_mean60    the average forward's / defenceman's production per 60 minutes (offence and
                 defence), from the last season's Pony Score rows: subtracted so production, like
                 every other part, is measured against an average player at his position
  a1, a2, fin    goals per primary / secondary assist and per goal above xG: the coefficients of a
                 non-negative least-squares fit of each skater's IMPACT offence
                 (goals per 82) on his per-82 rates of goals-above-xG, xG,
                 primary and secondary assists, by position, over the same
                 seasons as the ratings window (60+ games), each divided by the
                 fitted weight of one goal of the player's own xG (so all of
                 them sit on the shooting credit's scale)

Usage (from pipeline/):  python tools/pony_score_calibrate.py
"""

from __future__ import annotations

import glob
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.optimize import nnls

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LAKE = os.path.join(ROOT, 'data', 'lake', 'parquet')
SHOTS = os.path.join(ROOT, 'pipeline', 'nhl_historical_shots.csv')
SHOTS_LAST = os.path.join(ROOT, 'pipeline', 'nhl_season_2025_2026_shots.csv')
RATINGS = os.path.join(ROOT, 'public', 'data', 'player_ratings.json')
OUT = os.path.join(ROOT, 'public', 'data', 'pony_score.json')

SEASONS = ['20232024', '20242025', '20252026']
FO_WINDOW = 20.0
BANDS = [0, 10, 20, 30, 40, 50, 60, 1000]

EV_COLS = ['game_id', 'event_id', 'sort_order', 'period', 'game_seconds', 'type_desc', 'event_team_id', 'zone_code',
           'pen_duration', 'pen_committed_by_id', 'pen_drawn_by_id', 'scorer_id', 'assist1_id', 'assist2_id', 'shooter_id',
           'sit_away_g', 'sit_away_sk', 'sit_home_sk', 'sit_home_g', 'event_team_is_home', 'shot_distance', 'is_shootout',
           'empty_net_against']


def load_events() -> pd.DataFrame:
    frames = []
    for s in SEASONS:
        for f in glob.glob(os.path.join(LAKE, 'events', f'season={s}', '**', '*.parquet'), recursive=True):
            frames.append(pd.read_parquet(f, columns=EV_COLS))
    e = pd.concat(frames, ignore_index=True)
    e = e[e.game_id.astype(str).str[4:6] == '02']                        # regular season
    e = e[~e.is_shootout.fillna(False).astype(bool)]
    for c in ['sit_away_g', 'sit_away_sk', 'sit_home_sk', 'sit_home_g', 'period']:
        e[c] = e[c].fillna(-1).astype(int)
    e['game_seconds'] = e.game_seconds.astype(float)
    e['event_team_is_home'] = e.event_team_is_home.fillna(False).astype(bool)
    e['empty_net_against'] = e.empty_net_against.fillna(False).astype(bool)
    return e.sort_values(['game_id', 'sort_order']).reset_index(drop=True)


def load_xg() -> pd.DataFrame:
    cols = ['game_id', 'event_id', 'xG']
    x = pd.concat([pd.read_csv(SHOTS, usecols=cols), pd.read_csv(SHOTS_LAST, usecols=cols)], ignore_index=True)
    return x.drop_duplicates(['game_id', 'event_id'])


def strength_time(e: pd.DataFrame) -> pd.DataFrame:
    """Seconds by game and state: each gap between events takes the state of the event before it."""
    g = e[['game_id', 'period', 'game_seconds', 'sit_away_g', 'sit_away_sk', 'sit_home_sk', 'sit_home_g']].copy()
    g['dt'] = g.groupby(['game_id', 'period']).game_seconds.shift(-1) - g.game_seconds
    g = g[g.dt > 0]
    return g


def main() -> None:
    e = load_events()
    x = load_xg()
    e = e.merge(x, on=['game_id', 'event_id'], how='left')
    unb = e.type_desc.isin(['goal', 'shot-on-goal', 'missed-shot'])
    goal = e.type_desc == 'goal'
    print(f'events {len(e):,} · unblocked with xG {(unb & e.xG.notna()).sum():,} / {unb.sum():,}')

    # k: goals per xG (all unblocked attempts that carry xG).
    s = e[unb & e.xG.notna()]
    k = float((s.type_desc == 'goal').sum() / s.xG.sum())

    # League rates per team-60 by state.
    st = strength_time(e)
    five = (st.sit_away_sk == 5) & (st.sit_home_sk == 5) & (st.sit_away_g == 1) & (st.sit_home_g == 1)
    t5 = float(st[five].dt.sum())
    pp_home = (st.sit_home_sk > st.sit_away_sk) & (st.sit_home_sk >= 4) & (st.sit_away_sk >= 3) & (st.sit_away_g == 1) & (st.sit_home_g == 1)
    pp_away = (st.sit_away_sk > st.sit_home_sk) & (st.sit_away_sk >= 4) & (st.sit_home_sk >= 3) & (st.sit_away_g == 1) & (st.sit_home_g == 1)
    t_pp = float(st[pp_home | pp_away].dt.sum())

    ev5 = (e.sit_away_sk == 5) & (e.sit_home_sk == 5) & (e.sit_away_g == 1) & (e.sit_home_g == 1)
    xg5 = float(e[unb & ev5].xG.sum())
    ev_xg60 = xg5 / 2 / (t5 / 3600)                                          # per team

    sh_home = e.event_team_is_home.fillna(False).astype(bool)
    own = np.where(sh_home, e.sit_home_sk, e.sit_away_sk)
    opp = np.where(sh_home, e.sit_away_sk, e.sit_home_sk)
    goalies = (e.sit_away_g == 1) & (e.sit_home_g == 1)
    on_pp = (own > opp) & (own >= 4) & (opp >= 3) & goalies
    on_sh = (own < opp) & (own >= 3) & (opp >= 4) & goalies
    pp_xg60 = float(e[unb & on_pp].xG.sum()) / (t_pp / 3600)

    # Power-play value: net goals during PP time per opportunity (transitions into a PP state), per two minutes.
    st2 = e[['game_id', 'period', 'sit_away_g', 'sit_away_sk', 'sit_home_sk', 'sit_home_g']].copy()
    st2['state'] = np.select(
        [(st2.sit_home_sk > st2.sit_away_sk) & (st2.sit_away_g == 1) & (st2.sit_home_g == 1) & (st2.sit_away_sk >= 3),
         (st2.sit_away_sk > st2.sit_home_sk) & (st2.sit_away_g == 1) & (st2.sit_home_g == 1) & (st2.sit_home_sk >= 3)],
        ['home', 'away'], 'none')
    prev = st2.groupby(['game_id', 'period']).state.shift(1).fillna('none')
    opps = int(((st2.state != 'none') & (st2.state != prev)).sum())
    pp_goals = int((goal & on_pp).sum())
    sh_goals = int((goal & on_sh).sum())
    net_per_opp = (pp_goals - sh_goals) / max(1, opps)
    minor_pims = e[(e.type_desc == 'penalty') & (e.pen_duration.isin([2, 4, 5]))].pen_duration.sum()
    # PP opportunities per two minutes of PP-causing penalty: most minors are one opportunity, majors and doubles more time.
    pen_value = float(net_per_opp)

    # Faceoff value by zone (from the winner's view), 5v5.
    fo = e[(e.type_desc == 'faceoff') & ev5].copy()
    shots5 = e[unb & e.xG.notna()][['game_id', 'period', 'game_seconds', 'event_team_id', 'xG']]
    fo_next = fo.groupby(['game_id', 'period']).game_seconds.shift(-1)
    fo['end'] = np.minimum(fo.game_seconds + FO_WINDOW, fo_next.fillna(1e9))
    m = fo[['game_id', 'period', 'game_seconds', 'end', 'event_team_id', 'zone_code']].reset_index().merge(
        shots5, on=['game_id', 'period'], suffixes=('', '_s'))
    m = m[(m.game_seconds_s >= m.game_seconds) & (m.game_seconds_s < m.end)]
    m['net'] = np.where(m.event_team_id_s == m.event_team_id, m.xG, -m.xG)
    net = m.groupby('index').net.sum().reindex(fo.index, fill_value=0.0)
    fo['net'] = net.values * k
    by_zone = fo.groupby('zone_code').net.mean().to_dict()
    fo_end = float((by_zone.get('O', 0.0) + by_zone.get('D', 0.0)) / 2)
    fo_neutral = float(by_zone.get('N', 0.0))

    # Blocked-attempt value: mean xG of 5v5 unblocked attempts by distance band.
    u5 = e[unb & ev5 & e.xG.notna() & e.shot_distance.notna()]
    band = pd.cut(u5.shot_distance, BANDS, right=False)
    block_xg = [round(float(v) * k, 4) for v in u5.groupby(band, observed=False).xG.mean().values]

    # Assist values: NNLS of IMPACT offence on per-82 rates, by position, players with 60+ games.
    lus = []
    for s_ in SEASONS:
        for f in glob.glob(os.path.join(LAKE, 'lineups', f'season={s_}', '**', '*.parquet'), recursive=True):
            lus.append(pd.read_parquet(f, columns=['game_id', 'player_id', 'position', 'toi_s', 'is_goalie']))
    lu = pd.concat(lus, ignore_index=True)
    lu = lu[(lu.game_id.astype(str).str[4:6] == '02') & (~lu.is_goalie.fillna(False).astype(bool)) & (lu.position != 'G')]
    gp = lu.groupby('player_id').game_id.nunique()
    pos = lu.groupby('player_id').position.agg(lambda p: 'D' if (p == 'D').mean() > 0.5 else 'F')
    shots_p = e[unb & e.xG.notna() & e.shooter_id.notna()].groupby('shooter_id').xG.sum() * k
    goals_p = e[goal & e.scorer_id.notna() & ~e.empty_net_against.fillna(False).astype(bool)].groupby('scorer_id').size()
    a1 = e[goal & e.assist1_id.notna()].groupby('assist1_id').size()
    a2 = e[goal & e.assist2_id.notna()].groupby('assist2_id').size()
    ratings = json.load(open(RATINGS))
    cols = ratings['columns']
    rows = [dict(zip(cols, r)) for r in ratings['rows']]
    rt = pd.DataFrame(rows).set_index('id')
    df = pd.DataFrame({'gp': gp, 'pos': pos}).join(rt[['off_impact', 'rated']], how='inner')
    df = df[(df.gp >= 60) & df.rated.astype(bool)]
    per82 = lambda s_: (s_.reindex(df.index).fillna(0) / df.gp * 82)
    df['ixg'] = per82(shots_p)
    df['fin'] = per82(goals_p) - df.ixg
    df['a1'] = per82(a1)
    df['a2'] = per82(a2)
    fits = {}
    for p_ in ['F', 'D']:
        d = df[df.pos == p_]
        X = d[['fin', 'ixg', 'a1', 'a2']].values
        Xc = X - X.mean(axis=0)                                              # IMPACT is centred on the position mean
        y = d.off_impact.values - d.off_impact.mean()
        coef, _ = nnls(Xc, y)
        pred = Xc @ coef
        r2 = 1 - ((y - pred) ** 2).sum() / (y ** 2).sum()
        fits[p_] = {'n': int(len(d)), 'fin': round(float(coef[0]), 4), 'ixg': round(float(coef[1]), 4),
                    'a1': round(float(coef[2]), 4), 'a2': round(float(coef[3]), 4), 'r2': round(float(r2), 3)}
    # Credit per assist in goals: the fitted IMPACT goals per assist relative to the fitted goals per xG of the
    # player's own shots, so an assist is valued on the same scale as the shooting credit (one xG = k goals).
    assist = {}
    for p_, f_ in fits.items():
        scale = 1.0 / f_['ixg'] if f_['ixg'] > 0 else 1.0
        assist[p_] = {'a1': round(min(1.0, f_['a1'] * scale), 4), 'a2': round(min(1.0, f_['a2'] * scale), 4),
                      'fin': round(min(1.0, f_['fin'] * scale), 4)}

    out = {
        'version': 1,
        'built_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'seasons': SEASONS,
        'k': round(k, 4),
        'ev_xg60': round(ev_xg60, 4),
        'pp_xg60': round(pp_xg60, 4),
        'pen_value': round(pen_value, 4),
        'fo_end': round(fo_end, 4),
        'fo_neutral': round(fo_neutral, 4),
        'block_bands_ft': BANDS[:-1],
        'block_xg': block_xg,
        'assist': assist,
        'fits': fits,
        'diagnostics': {
            'ev5_hours': round(t5 / 3600, 1), 'pp_hours': round(t_pp / 3600, 1), 'pp_opportunities': opps,
            'pp_goals': pp_goals, 'sh_goals': sh_goals, 'penalty_minutes_minor_major': int(minor_pims),
            'faceoffs_5v5': int(len(fo)), 'faceoff_net_by_zone': {z: round(float(v), 4) for z, v in by_zone.items()},
            'ratings_pen_value': ratings.get('impact', {}).get('pen_value'),
        },
    }
    # Production centring: the average forward's / defenceman's production per 60 minutes, from the last full
    # season of Pony Score rows (scripts/pony_scores.ts). Stored rows are already centred by the previous
    # constants, so the old centring is added back before averaging.
    prior = os.path.join(ROOT, 'public', 'data', 'pony', f'{SEASONS[-1]}.json')
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    old_mean = old.get('prod_mean60') or {}
    if os.path.exists(prior):
        doc = json.load(open(prior))
        ix = {c: i for i, c in enumerate(doc['skater_cols'])}
        means = {}
        for pos in ('F', 'D'):
            rows = [r for r in doc['skaters'] if r[ix['pos']] == pos]
            hours = sum(r[ix['toi']] for r in rows) / 3600
            om = old_mean.get(pos, {})
            means[pos] = {
                'o': round((sum(r[ix['oProd']] for r in rows) + om.get('o', 0.0) * hours) / hours, 4),
                'd': round((sum(r[ix['dProd']] for r in rows) + om.get('d', 0.0) * hours) / hours, 4),
            }
        out['prod_mean60'] = means
        out['prod_mean_source'] = f'public/data/pony/{SEASONS[-1]}.json'
    elif old_mean:
        out['prod_mean60'] = old_mean
    with open(OUT, 'w') as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
