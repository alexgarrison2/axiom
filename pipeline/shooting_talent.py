"""
Shooting talent - a SEPARATE, leak-free finishing feature (C6).

What changed
------------
The old version multiplied every shot's xG by the shooter's goals/xG ratio
over the current and last two seasons.  That leaked outcomes into the model
inputs: a 2022-23 shot carried the player's 2025-26 finishing, this season's
goals raised this season's xG, and goalie GSAx absorbed shooter variance.

Now:
* The shot model's raw output is kept in ``xg_raw`` and ``xG`` is NOT
  multiplied.  The game model, backtests and goalie ratings use raw xG.
* Talent is estimated per (player, season S) from seasons S-1, S-2, S-3 only
  (weights 0.5 / 0.3 / 0.2), never from the season it is applied to, using raw
  xG, measured against each season's league 5v5 goals/xG so the average
  multiplier is ~1.  It is written to shooting_talent.json;
  ``talent_multipliers`` gives the per-shot factor (talent xG = xg_raw x
  multiplier) for display or as a candidate feature.

Bayesian shrinkage (conjugate gamma-Poisson):
    multiplier = (weighted goals + PRIOR_XG) / (weighted league-scaled xG + PRIOR_XG)
clipped to [TALENT_FLOOR, TALENT_CEILING].

refresh_pipeline.py keeps calling:
    talent = compute_shooting_talent()
    apply_shooting_talent(shots_df, talent)
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from season import START_YEAR, season_file

PRIOR_XG = 40.0          # ~550 5v5 shots of league-average finishing
TALENT_FLOOR = 0.75
TALENT_CEILING = 1.35
PRIOR_SEASON_WEIGHTS = (0.50, 0.30, 0.20)   # seasons S-1, S-2, S-3
TALENT_STRENGTH_STATES = ('5v5',)
NHL_GAME_TYPES = ('02', '03')
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_NAME = 'shooting_talent.json'


def extract_season(game_id):
    """Season start year from an NHL game id (2024020567 -> 2024)."""
    return int(str(game_id)[:4])


def _raw_xg(shots: pd.DataFrame, pipeline_dir) -> pd.Series:
    """Raw shot-model xG: the ``xg_raw`` column when present, else re-score
    (the on-disk ``xG`` of old files is talent-adjusted and normalised)."""
    if 'xg_raw' in shots.columns and shots['xg_raw'].notna().any():
        return pd.to_numeric(shots['xg_raw'], errors='coerce')
    import features as F
    return F._score_raw_xg(shots, pipeline_dir)


def talent_table(shots: pd.DataFrame, target_seasons, xg_col='xg_raw') -> pd.DataFrame:
    """Rows (player_id, season, goals_w, xg_w, talent_mult) for each target
    season, using ONLY the three seasons before it."""
    s = shots[shots['strength_state'].isin(TALENT_STRENGTH_STATES)].copy()
    s['season'] = s['game_id'].map(extract_season)
    s['is_goal'] = pd.to_numeric(s['is_goal'], errors='coerce').fillna(0)
    s[xg_col] = pd.to_numeric(s[xg_col], errors='coerce').fillna(0)
    s['player_id'] = pd.to_numeric(s['player_id'], errors='coerce')
    s = s.dropna(subset=['player_id'])
    per = s.groupby(['player_id', 'season']).agg(goals=('is_goal', 'sum'), xg=(xg_col, 'sum')).reset_index()
    # expected goals at that season's league finishing rate (so league average = 1.0)
    lg = s.groupby('season').agg(g=('is_goal', 'sum'), x=(xg_col, 'sum'))
    per['xg'] = per['xg'] * per['season'].map((lg['g'] / lg['x']).where(lg['x'] > 0, 1.0))
    out = []
    for S in target_seasons:
        parts = []
        for k, w in enumerate(PRIOR_SEASON_WEIGHTS, start=1):
            p = per[per['season'] == S - k]
            if len(p):
                parts.append(p.assign(goals=p['goals'] * w, xg=p['xg'] * w))
        if not parts:
            continue
        agg = pd.concat(parts).groupby('player_id')[['goals', 'xg']].sum().reset_index()
        agg['talent_mult'] = ((agg['goals'] + PRIOR_XG) / (agg['xg'] + PRIOR_XG)).clip(TALENT_FLOOR, TALENT_CEILING)
        agg['season'] = S
        out.append(agg)
    if not out:
        return pd.DataFrame(columns=['player_id', 'season', 'goals', 'xg', 'talent_mult'])
    t = pd.concat(out, ignore_index=True)
    t['player_id'] = t['player_id'].astype(int)
    return t


def compute_shooting_talent(pipeline_dir=None, current_season=START_YEAR):
    """Per-season talent maps {season: {player_id: multiplier}} for every
    season in the shot files (each from prior seasons only).  Saves
    shooting_talent.json and returns the nested dict."""
    pipeline_dir = pipeline_dir or SCRIPT_DIR
    files = [os.path.join(pipeline_dir, 'nhl_historical_shots.csv')]
    for sy in (current_season - 1, current_season):
        files.append(os.path.join(pipeline_dir, season_file('shots', sy)))
    frames = []
    for f in dict.fromkeys(files):
        if not os.path.exists(f):
            continue
        df = pd.read_csv(f, low_memory=False)
        if df.empty:
            continue
        df = df[df['game_id'].astype(str).str[4:6].isin(NHL_GAME_TYPES)]
        df = df.assign(xg_raw=_raw_xg(df, pipeline_dir))
        frames.append(df[['game_id', 'player_id', 'is_goal', 'xg_raw', 'strength_state']])
        print(f"  Loaded {len(df):,} shots from {os.path.basename(f)}")
    if not frames:
        print("  No shot data found - empty talent map")
        return {}
    shots = pd.concat(frames, ignore_index=True).drop_duplicates()
    seasons = sorted(set(shots['game_id'].map(extract_season)) | {current_season})
    t = talent_table(shots, seasons)
    talent = {int(S): dict(zip(g['player_id'].astype(int), g['talent_mult'].round(4)))
              for S, g in t.groupby('season')}
    cur = t[(t['season'] == current_season) & (t['xg'] > 5)]
    if len(cur):
        print(f"  {current_season}: {len(cur)} players with >5 weighted xG; multiplier "
              f"{cur['talent_mult'].min():.3f}-{cur['talent_mult'].max():.3f} (mean {cur['talent_mult'].mean():.3f})")
    payload = {
        'method': ('multiplier = (weighted goals + %g) / (weighted raw xG + %g) over 5v5 shots of seasons '
                   'S-1..S-3 (weights %s); never uses season S itself' % (PRIOR_XG, PRIOR_XG, list(PRIOR_SEASON_WEIGHTS))),
        'current_season': current_season,
        'by_season': {str(S): {str(k): v for k, v in m.items()} for S, m in talent.items()},
    }
    with open(os.path.join(pipeline_dir, OUT_NAME), 'w') as f:
        json.dump(payload, f)
    print(f"  Saved talent factors for seasons {sorted(talent)} to {OUT_NAME}")
    return talent


def load_shooting_talent(pipeline_dir=None):
    """{season: {player_id: multiplier}}.  A legacy flat file (one map) is
    treated as the current season's map."""
    path = os.path.join(pipeline_dir or SCRIPT_DIR, OUT_NAME)
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and 'by_season' in data:
        return {int(S): {int(k): v for k, v in m.items()} for S, m in data['by_season'].items()}
    return {START_YEAR: {int(k): v for k, v in data.items()}}


def talent_multipliers(shots_df, talent_map) -> pd.Series:
    """Per-shot multiplier from the shooter's PRIOR-seasons talent for the
    shot's season (1.0 when unknown).  ``xg_raw * multiplier`` is the
    talent-adjusted xG, available as a separate feature / display value."""
    if not talent_map:
        return pd.Series(1.0, index=shots_df.index)
    if not isinstance(next(iter(talent_map.values())), dict):
        talent_map = {START_YEAR: talent_map}          # legacy flat map
    season = shots_df['game_id'].map(extract_season)
    pid = pd.to_numeric(shots_df['player_id'], errors='coerce')
    mult = pd.Series(1.0, index=shots_df.index)
    for S, m in talent_map.items():
        sel = season == int(S)
        if sel.any():
            mult[sel] = pid[sel].map(m).fillna(1.0)
    return mult


def apply_shooting_talent(shots_df, talent_map):
    """Record the shot model's raw output in ``xg_raw`` and leave ``xG``
    unchanged: no finishing outcome is multiplied into model inputs any more.
    The talent itself stays available through ``talent_multipliers`` and
    shooting_talent.json.  Modifies and returns ``shots_df``."""
    shots_df['xg_raw'] = pd.to_numeric(shots_df['xG'], errors='coerce')
    mult = talent_multipliers(shots_df, talent_map)
    n = int((mult != 1.0).sum())
    print(f"  Shooting talent: xG kept raw (xg_raw); {n}/{len(shots_df)} shots have a prior-season "
          f"talent multiplier (separate feature, not applied)")
    return shots_df


if __name__ == '__main__':
    print('Computing shooting talent factors (prior seasons only)...')
    t = compute_shooting_talent()
    print(f"Done: {sum(len(m) for m in t.values())} player-season factors.")
