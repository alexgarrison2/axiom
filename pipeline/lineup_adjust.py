#!/usr/bin/env python3
"""
lineup_adjust.py - team-relative, coverage-gated, injury-aware lineup term (C7).

Replaces the predict_games lineup engine, which multiplied team ratings by
(lineup on-ice xG / LEAGUE average) - re-counting team strength that the
ratings already contain - amplified the weight by min(0.8, w * (1 + 4 * dev)),
and called a lineup 'reliable' with 5 of 18 players matched.

Here:
* A skater's value is his RAPM net impact (calc_rapm.py: ridge regression on
  5v5 stints, xG/60 for minus against), not raw on-ice rates.
* Lineup quality Q = sum over the dressed skaters of value x typical share of
  5v5 ice time.  The adjustment is RELATIVE TO THE TEAM'S OWN BASELINE
  lineup (its 18 most-used skaters over its last 20 games):
      dq_team = Q(tonight) - Q(baseline)
  so a team's normal lineup is exactly neutral.
* Coverage gate: at least MIN_MATCHED of the 18 skaters must have a rating,
  on BOTH sides, otherwise ``adjust`` returns None for the game.
* Players listed Out / IR (ESPN injuries, B8) are removed from tonight's
  lineup before matching.
* The logit weight is fitted by a walk-forward backtest (``backtest``) and is
  0 unless the lineup term improves out-of-sample log loss.
* No special-teams layer: special teams are already in the game model's
  all-situations xG share, so this module adds exactly one term.

Serving (predict_games, A10):
    adj = LineupAdjuster.from_files()
    r = adj.adjust('CAR', 'FLA', home_names, away_names, injured={'CAR': [...], ...})
    if r: extra_terms.append(('lineup', 'Lineup & injuries', r['logit']))

CLI:
    python3 lineup_adjust.py --backtest   # writes tests/out/lineup_backtest.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

COEFF_PATH = os.path.join(SCRIPT_DIR, 'scoring_coefficients.json')
BACKTEST_PATH = os.path.join(SCRIPT_DIR, 'tests', 'out', 'lineup_backtest.json')
LINEUP_SIZE = 18
MIN_MATCHED = 14
BASELINE_GAMES = 20
MIN_BASELINE_GAMES = 5
DEFAULT_SHARE = 0.30          # typical share of 5v5 time for a skater without history
OUT_STATUSES = ('out', 'ir', 'injured reserve', 'ltir', 'long-term injured reserve', 'suspended')


def _norm(name) -> str:
    n = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode().lower()
    return ' '.join(''.join(c if c.isalnum() or c == ' ' else ' ' for c in n).split())


def _sigmoid(z):
    return 1 / (1 + math.exp(-z))


def fitted_weight(default=0.0):
    try:
        with open(COEFF_PATH) as f:
            v = json.load(f).get('lineup_weight')
        if isinstance(v, dict):
            v = v.get('value')
        return float(v) if v is not None else default
    except Exception:
        return default


# ─── Core maths (pure, unit-tested) ───────────────────────────────────────────

def lineup_quality(ids, values, shares):
    """(Q, matched ids).  Q = sum(value x share) over skaters with a value."""
    matched = [p for p in ids if p in values]
    q = float(sum(values[p] * shares.get(p, DEFAULT_SHARE) for p in matched))
    return q, matched


def team_delta(tonight, baseline, values, shares, min_matched=MIN_MATCHED):
    """dq = Q(tonight) - Q(baseline) on the team's own baseline, or None when
    fewer than ``min_matched`` of tonight's skaters have a value."""
    q_t, m_t = lineup_quality(tonight, values, shares)
    if len(m_t) < min_matched:
        return None, len(m_t)
    q_b, _ = lineup_quality(baseline, values, shares)
    return q_t - q_b, len(m_t)


def baseline_lineup(recent_games, size=LINEUP_SIZE):
    """18 most-used skaters over the given recent games (lists of ids)."""
    c = Counter(p for g in recent_games for p in set(g))
    return [p for p, _ in c.most_common(size)]


# ─── Serving ──────────────────────────────────────────────────────────────────

class LineupAdjuster:
    def __init__(self, values, shares, baselines, name_to_id, weight=None):
        self.values = values            # {player_id: RAPM net xG/60}
        self.shares = shares            # {player_id: share of 5v5 time}
        self.baselines = baselines      # {team_abbrev: [player_id, ...]}
        self.name_to_id = name_to_id    # {normalised name: player_id}
        self.weight = fitted_weight() if weight is None else weight

    @classmethod
    def from_files(cls, pipeline_dir=SCRIPT_DIR):
        from season import season_file, START_YEAR
        with open(os.path.join(pipeline_dir, 'rapm_scores.json')) as f:
            rapm = json.load(f)
        values = {int(k): float(v['rapm_net']) for k, v in rapm.items()}
        shifts = None
        for sy in (START_YEAR, START_YEAR - 1):
            p = os.path.join(pipeline_dir, season_file('shifts', sy))
            if os.path.exists(p):
                s = pd.read_csv(p, low_memory=False)
                if len(s):
                    shifts = s
                    break
        baselines, shares, name_to_id = {}, {}, {}
        if shifts is not None:
            dressed = dressed_skaters(shifts, goalie_ids(pipeline_dir))
            for team, g in dressed.groupby('team_abbrev'):
                g = g.sort_values('game_id')
                games = [list(x) for x in g.groupby('game_id')['player_id'].apply(list).tail(BASELINE_GAMES)]
                baselines[team] = baseline_lineup(games)
            shares = toi_shares(shifts)
            ok = shifts.dropna(subset=['player_id'])
            name_to_id = {_norm(n): int(p) for n, p in zip(ok['player_name'], ok['player_id'])}
        try:
            with open(os.path.join(pipeline_dir, 'player_name_lookup.json')) as f:
                lk = json.load(f).get('by_full_name', {})
            for n, p in lk.items():
                name_to_id.setdefault(_norm(n), int(p))
        except Exception:
            pass
        return cls(values, shares, baselines, name_to_id)

    def resolve(self, names):
        ids, unknown = [], []
        for n in names:
            pid = self.name_to_id.get(_norm(n))
            (ids if pid is not None else unknown).append(pid if pid is not None else n)
        return ids, unknown

    @staticmethod
    def _drop_injured(names, injured):
        out = {_norm(i.get('name', '')) for i in (injured or [])
               if str(i.get('status', '')).strip().lower() in OUT_STATUSES}
        return [n for n in names if _norm(n) not in out], sorted(out)

    def adjust(self, home, away, home_names, away_names, injured=None):
        """Lineup logit term for the home side, or None (coverage gate)."""
        injured = injured or {}
        res = {}
        for side, team, names in (('home', home, home_names), ('away', away, away_names)):
            names, removed = self._drop_injured(names, injured.get(team))
            ids, unknown = self.resolve(names)
            base = self.baselines.get(team)
            if not base:
                return None
            dq, matched = team_delta(ids[:LINEUP_SIZE], base, self.values, self.shares)
            if dq is None:
                return None
            res[side] = {'dq': dq, 'matched': matched, 'unknown': unknown, 'removed_injured': removed}
        x = res['home']['dq'] - res['away']['dq']
        return {'logit': self.weight * x, 'x': x, 'weight': self.weight,
                'home': res['home'], 'away': res['away']}


# ─── Data helpers ─────────────────────────────────────────────────────────────

def goalie_ids(pipeline_dir=SCRIPT_DIR):
    ids = set()
    for p in (os.path.join(ROOT, 'public', 'data', 'nhl_season_2025_2026_player_stats.csv'),):
        if os.path.exists(p):
            ps = pd.read_csv(p, usecols=['player_id', 'is_goalie'], low_memory=False)
            ids |= set(ps.loc[ps['is_goalie'].astype(str).isin(['1', 'True', 'true']), 'player_id'].astype(int))
    try:
        import calc_rapm
        ids |= calc_rapm._build_goalie_set()
    except Exception:
        pass
    return ids


def resolved_shifts(shifts):
    import contextlib
    import io
    import calc_rapm
    with contextlib.redirect_stdout(io.StringIO()):
        s = calc_rapm._resolve_player_ids(shifts)
    s = s[s['resolved_id'].notna()].copy()
    s['player_id'] = s['resolved_id'].astype(int)
    return s


def dressed_skaters(shifts, goalies):
    s = shifts if 'resolved_id' in shifts.columns else resolved_shifts(shifts)
    s = s[~s['player_id'].isin(goalies)]
    return s[['game_id', 'team_abbrev', 'team_id', 'player_id']].drop_duplicates()


def toi_shares(shifts):
    """Player share of his team's ice time per game played (all strengths),
    scaled so a team's 18 skaters sum to ~5 skaters on the ice."""
    s = shifts if 'resolved_id' in shifts.columns else resolved_shifts(shifts)
    s = s.assign(dur=(s['end_seconds'] - s['start_seconds']).clip(lower=0))
    per = s.groupby(['player_id', 'game_id'])['dur'].sum().reset_index()
    per = per[per['dur'] > 0]
    mean_toi = per.groupby('player_id')['dur'].mean()
    return (mean_toi / 3600.0).clip(upper=0.6).to_dict()


# ─── Backtest ─────────────────────────────────────────────────────────────────

def _ll(y, p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def _fit_w(z, x, y, grid=np.linspace(-1.0, 3.0, 81)):
    return float(min(grid, key=lambda w: _ll(y, 1 / (1 + np.exp(-(z + w * x)))).mean()))


def backtest(season=2025, cutoffs=('2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'),
             out_path=BACKTEST_PATH, verbose=True):
    """Walk-forward ablation inside a season with shift data.

    For each monthly cutoff, RAPM is fitted on stints BEFORE it (alpha by CV
    on the first cutoff) and applied to games in the following month.
    Tonight's lineup = the skaters who dressed (from shifts; lineups are
    public before puck drop), baseline = the team's 18 most-used skaters over
    its previous 20 games.  The base probability is the game model's
    walk-forward out-of-sample prediction (cache/walkforward_oos.csv).
    The weight is fitted on the first half of eligible games and tested on
    the second half, and vice versa."""
    import contextlib
    import io
    import calc_rapm
    import features as F
    from season import season_file
    from scipy.sparse import vstack  # noqa: F401

    t0 = datetime.now(timezone.utc)
    shifts = pd.read_csv(os.path.join(SCRIPT_DIR, season_file('shifts', season)), low_memory=False)
    shots = pd.read_csv(os.path.join(SCRIPT_DIR, season_file('shots', season)), low_memory=False)
    shots = shots[shots['game_id'].astype(str).str[4:6].isin(F.NHL_GAME_TYPES)].copy()
    shots['xG'] = F._score_raw_xg(shots, SCRIPT_DIR)          # raw xG: no talent / normalisation
    gs = pd.read_csv(os.path.join(SCRIPT_DIR, season_file('gamestats', season)), low_memory=False)
    gs = gs[gs['game_id'].astype(str).str[4:6].isin(F.NHL_GAME_TYPES)]
    teams = pd.read_csv(os.path.join(SCRIPT_DIR, 'nhl_teams.csv'))
    tid = dict(zip(teams['Common Name'], teams['NHL Team ID'].astype(int)))
    home_rows = gs[gs['home_away'] == 'Home']
    home_lookup = {int(g): tid.get(t) for g, t in zip(home_rows['game_id'], home_rows['team']) if tid.get(t)}
    game_date = dict(zip(home_rows['game_id'].astype(int), pd.to_datetime(home_rows['game_date'])))

    s = resolved_shifts(shifts)
    goalies = goalie_ids()
    with contextlib.redirect_stdout(io.StringIO()):
        stints = calc_rapm._build_stints(s, home_lookup, goalies)
        stints = calc_rapm._attribute_shots_to_stints(stints, shots, home_lookup)
    if verbose:
        print(f"[lineup] {len(stints):,} stints, {len(home_lookup)} games")
    dressed = dressed_skaters(s, goalies)
    dressed = dressed[dressed['game_id'].isin(home_lookup)]
    dressed['date'] = dressed['game_id'].map(game_date)
    team_games = {team: g.groupby('game_id').agg(date=('date', 'first'), ids=('player_id', list))
                  .sort_values('date') for team, g in dressed.groupby('team_id')}
    oos = pd.read_csv(os.path.join(F.CACHE_DIR, 'walkforward_oos.csv'))
    oos = oos[oos['season'] == season].set_index('game_id')

    rows = []
    alpha = None
    bounds = [pd.Timestamp(c) for c in cutoffs] + [pd.Timestamp('2100-01-01')]
    for lo, hi in zip(bounds[:-1], bounds[1:]):
        train = [st for st in stints if game_date.get(st['game_id'], lo) < lo]
        with contextlib.redirect_stdout(io.StringIO()):
            X, y_off, y_def, w, pidx = calc_rapm._build_design_matrix(train)
            if alpha is None:
                _, alpha, _ = calc_rapm._fit_ridge_cv(X, y_off - y_def, w, calc_rapm.ALPHA_RANGE_FAST, 'net')
            from sklearn.linear_model import Ridge
            m = Ridge(alpha=alpha, solver='sparse_cg', max_iter=5000).fit(X, y_off - y_def, sample_weight=w)
        inv = {i: p for p, i in pidx.items()}
        # RAPM coefficient: +1 home / -1 away on (xGF - xGA)/60 -> net impact per 60
        values = {inv[i]: float(c) for i, c in enumerate(m.coef_)}
        s_train = s[s['game_id'].astype(int).map(game_date) < lo]
        shares = toi_shares(s_train)
        for gid, d in game_date.items():
            if not (lo <= d < hi) or gid not in oos.index:
                continue
            h_t = home_lookup[gid]
            a_t = next((t for t in team_games if t != h_t and gid in team_games[t].index), None)
            if a_t is None or h_t not in team_games:
                continue
            out = {}
            for side, t in (('h', h_t), ('a', a_t)):
                tg = team_games[t]
                prior = tg[tg['date'] < d].tail(BASELINE_GAMES)
                if len(prior) < MIN_BASELINE_GAMES:
                    break
                base = baseline_lineup(list(prior['ids']))
                tonight = tg.loc[gid, 'ids']
                dq, matched = team_delta(tonight, base, values, shares)
                out[side] = (dq, matched)
            if len(out) < 2:
                continue
            r = oos.loc[gid]
            p = float(r['p_model'])
            rows.append({'game_id': int(gid), 'date': d, 'y': int(r['home_win']), 'z': math.log(p / (1 - p)),
                         'dq_h': out['h'][0], 'dq_a': out['a'][0], 'm_h': out['h'][1], 'm_a': out['a'][1]})
    D = pd.DataFrame(rows).sort_values(['date', 'game_id']).reset_index(drop=True)
    D['eligible'] = D['dq_h'].notna() & D['dq_a'].notna()
    E = D[D['eligible']].copy()
    E['x'] = E['dq_h'] - E['dq_a']
    half = len(E) // 2
    A, B = E.iloc[:half], E.iloc[half:]
    w_a, w_b = _fit_w(A['z'].values, A['x'].values, A['y'].values), _fit_w(B['z'].values, B['x'].values, B['y'].values)

    def held(Tr_w, Te):
        base = _ll(Te['y'], 1 / (1 + np.exp(-Te['z'])))
        withl = _ll(Te['y'], 1 / (1 + np.exp(-(Te['z'] + Tr_w * Te['x']))))
        return base, withl
    b1, l1 = held(w_a, B)
    b2, l2 = held(w_b, A)
    diff = np.concatenate([l1 - b1, l2 - b2])
    d_mean, d_se = float(diff.mean()), float(diff.std(ddof=1) / math.sqrt(len(diff)))
    w_all = _fit_w(E['z'].values, E['x'].values, E['y'].values)
    improves = d_mean < 0 and (l1.mean() < b1.mean()) and (l2.mean() < b2.mean())
    weight = w_all if improves else 0.0
    report = {
        'generated_at': t0.isoformat(),
        'season': f"{season}-{str(season + 1)[2:]}",
        'method': ('monthly walk-forward RAPM (net xG/60, ridge, alpha by 5-fold CV at the first cutoff) on raw '
                   'xG; tonight = dressed skaters, baseline = 18 most-used over the previous 20 games; '
                   'base = walk-forward game-model probability; weight fitted on one half, tested on the other'),
        'cutoffs': list(cutoffs), 'ridge_alpha': alpha,
        'games_scored': int(len(D)), 'games_eligible': int(len(E)),
        'coverage_gate': f'>= {MIN_MATCHED} of {LINEUP_SIZE} skaters rated on both sides',
        'x_sd': float(E['x'].std()), 'x_mean_abs': float(E['x'].abs().mean()),
        'weights': {'half_1': w_a, 'half_2': w_b, 'all': w_all},
        'held_out': {'base_log_loss': float(np.concatenate([b1, b2]).mean()),
                     'with_lineup_log_loss': float(np.concatenate([l1, l2]).mean()),
                     'delta': d_mean, 'delta_se': d_se,
                     'half_1_trained_tested_on_2': {'base': float(b1.mean()), 'with': float(l1.mean())},
                     'half_2_trained_tested_on_1': {'base': float(b2.mean()), 'with': float(l2.mean())}},
        'decision': ('lineup term improves held-out log loss in both halves: weight = %.3f' % weight) if improves
        else 'lineup term does not improve held-out log loss in both halves: weight = 0',
        'lineup_weight': weight,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    if verbose:
        print(json.dumps({k: report[k] for k in ('games_scored', 'games_eligible', 'weights', 'held_out', 'decision')},
                         indent=1, default=str))
    return report


def save_weight(report):
    with open(COEFF_PATH) as f:
        c = json.load(f)
    c['lineup_weight'] = {'value': round(report['lineup_weight'], 4),
                          'fit': 'lineup_adjust.py --backtest (tests/out/lineup_backtest.json)',
                          'held_out_delta': report['held_out']['delta'], 'n_games': report['games_eligible'],
                          'fitted_at': report['generated_at']}
    with open(COEFF_PATH, 'w') as f:
        json.dump(c, f, indent=2)


# ═══ Fast track F1: point-in-time lineup store (boxscore dressed lineups) ═══
# DESIGN §8 F1 / §3.7.  One compact row per dressed player per game, from the
# NHL boxscore (the free source of truth for who dressed and their TOI):
#   game_id, game_date, side (H/A), team (tricode), player_id, name (as the
#   boxscore prints it, 'J. Staal'), sweater, pos (F/D/G), toi_sec, starter
# Stored per season as pipeline/models/fasttrack/lineups_<start year>.csv.gz
# (~1 MB per season).  Historical seasons are fetched once (polite: <= 2 rps);
# the current season is topped up gap-driven by predict_games (only completed
# games missing from the file are fetched).

FT_DIR = os.path.join(SCRIPT_DIR, 'models', 'fasttrack')
LINEUP_COLS = ['game_id', 'game_date', 'side', 'team', 'player_id', 'name', 'sweater', 'pos', 'toi_sec', 'starter']
BOXSCORE_URL = 'https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore'
FETCH_MIN_INTERVAL = 0.6        # seconds between boxscore requests (<= ~1.7 rps)


def lineup_store_path(season, ft_dir=None):
    return os.path.join(ft_dir or FT_DIR, f'lineups_{int(season)}.csv.gz')


def _toi_seconds(s):
    try:
        m, sec = str(s).split(':')
        return int(m) * 60 + int(sec)
    except Exception:
        return 0


def parse_boxscore(box) -> list[dict]:
    """Dressed-player rows of one boxscore JSON (skaters and goalies)."""
    gid = int(box['id'])
    date = str(box.get('gameDate', ''))[:10]
    out = []
    pbg = box.get('playerByGameStats') or {}
    for side, key in (('H', 'homeTeam'), ('A', 'awayTeam')):
        team = (box.get(key) or {}).get('abbrev')
        grp = pbg.get(key) or {}
        for pos, plist in (('F', grp.get('forwards')), ('D', grp.get('defense')), ('G', grp.get('goalies'))):
            for p in plist or []:
                name = p.get('name')
                name = name.get('default') if isinstance(name, dict) else name
                out.append({'game_id': gid, 'game_date': date, 'side': side, 'team': team,
                            'player_id': int(p['playerId']), 'name': name or '',
                            'sweater': p.get('sweaterNumber'), 'pos': pos,
                            'toi_sec': _toi_seconds(p.get('toi')),
                            'starter': bool(p.get('starter')) if pos == 'G' else False})
    return out


def load_lineup_store(seasons=None, ft_dir=None) -> pd.DataFrame:
    """All stored dressed lineups (optionally only some seasons)."""
    ft_dir = ft_dir or FT_DIR
    frames = []
    if os.path.isdir(ft_dir):
        for fn in sorted(os.listdir(ft_dir)):
            if not (fn.startswith('lineups_') and fn.endswith('.csv.gz')):
                continue
            s = int(fn[len('lineups_'):-len('.csv.gz')])
            if seasons is not None and s not in seasons:
                continue
            frames.append(pd.read_csv(os.path.join(ft_dir, fn)))
    if not frames:
        return pd.DataFrame(columns=LINEUP_COLS)
    df = pd.concat(frames, ignore_index=True)
    df['game_date'] = pd.to_datetime(df['game_date']).dt.normalize()
    return df.drop_duplicates(subset=['game_id', 'player_id']).sort_values(['game_date', 'game_id', 'side'])


def _write_store(df, season, ft_dir=None):
    path = lineup_store_path(season, ft_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    df = df.sort_values(['game_id', 'side', 'pos', 'player_id'])[LINEUP_COLS]
    tmp = path + '.tmp'
    df.to_csv(tmp, index=False, compression={'method': 'gzip', 'mtime': 0})
    os.replace(tmp, path)


def _append(have, rows):
    new = pd.DataFrame(rows, columns=LINEUP_COLS)
    return new if have.empty else pd.concat([have, new], ignore_index=True)


def fetch_lineups(game_ids, season, ft_dir=None, min_interval=FETCH_MIN_INTERVAL, verbose=True,
                  checkpoint_every=200, getter=None):
    """Fetch the boxscores of ``game_ids`` missing from the season's store and
    append them.  Resumable (checkpoints every ``checkpoint_every`` games);
    returns the number of games added.  ``getter`` is injectable for tests."""
    import time
    if getter is None:
        from http_utils import get_json
        getter = lambda gid: get_json(BOXSCORE_URL.format(gid=gid), timeout=20)  # noqa: E731
    path = lineup_store_path(season, ft_dir)
    have = pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=LINEUP_COLS)
    done = set(have['game_id'].astype(int)) if len(have) else set()
    todo = [int(g) for g in game_ids if int(g) not in done]
    rows, added, last = [], 0, 0.0
    for i, gid in enumerate(todo, 1):
        wait = min_interval - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        try:
            r = parse_boxscore(getter(gid))
        except Exception as e:
            if verbose:
                print(f"  [lineups] {gid}: {e}")
            continue
        if sum(1 for x in r if x['pos'] != 'G') < 12:     # boxscore not populated (future / postponed)
            continue
        rows.extend(r)
        added += 1
        if rows and (i % checkpoint_every == 0 or i == len(todo)):
            have = _append(have, rows)
            _write_store(have, season, ft_dir)
            rows = []
            if verbose:
                print(f"  [lineups] {season}: {i}/{len(todo)} fetched")
    if rows:
        have = _append(have, rows)
        _write_store(have, season, ft_dir)
    return added


def completed_game_ids(seasons, pipeline_dir=SCRIPT_DIR):
    """Completed NHL (02/03) game ids per season from the gamestats files."""
    import features as F
    g = F.load_gamestats(pipeline_dir)
    g = g[g['season'].isin(seasons)]
    return {int(s): sorted(set(x['game_id'].astype(int))) for s, x in g.groupby('season')}


# ═══ Fast track F1: point-in-time player ratings (MoneyPuck, credited) ═══
# Skater value = 5v5 on-ice relative net xG per 60 (on-ice xGF-xGA per 60
# minus the team's off-ice xGF-xGA per 60), aggregated over the two seasons
# BEFORE the game's season (weights 1.0 / 0.5) and shrunk toward 0 by 5v5
# minutes.  Data: MoneyPuck.com season summaries (free for non-commercial
# use, credit required; DECISIONS D3).  Only completed seasons < S are read,
# so a rating used in season S is "as of" July 1 of S, before every game of
# S (asserted in tests/test_fasttrack_features.py).

MP_URL = 'https://moneypuck.com/moneypuck/playerData/seasonSummary/{y}/regular/skaters.csv'
MP_PATH = os.path.join(FT_DIR, 'mp_skaters.csv.gz')
MP_COLS = ['player_id', 'season', 'name', 'pos', 'gp', 'toi_all', 'toi5', 'on_f5', 'on_a5',
           'off_f5', 'off_a5', 'bench5', 'ixg_all']
RATING_SEASON_WEIGHTS = (1.0, 0.5)    # seasons S-1, S-2
RATING_SHRINK_MIN = 600.0             # 5v5 minutes at which a rating is 50% data / 50% league average
UNRATED_GP = 20                        # players below this many weighted GP define the "unrated" value
DEFAULT_TOI = {'F': 900.0, 'D': 1200.0}   # seconds per game without any history
TOI_HISTORY = 20                       # dressed games behind a player's expected TOI
TEAM_ALIASES = {'ARI': 'UTA'}          # franchise continuity for baselines


def extract_mp(raw: pd.DataFrame) -> pd.DataFrame:
    """Compact per (player, season) row from a MoneyPuck skaters.csv."""
    a = raw[raw['situation'] == 'all']
    f = raw[raw['situation'] == '5on5']
    a = a.groupby('playerId').agg(season=('season', 'first'), name=('name', 'first'), position=('position', 'first'),
                                  gp=('games_played', 'sum'), toi_all=('icetime', 'sum'), ixg_all=('I_F_xGoals', 'sum'))
    f = f.groupby('playerId').agg(toi5=('icetime', 'sum'), on_f5=('OnIce_F_xGoals', 'sum'),
                                  on_a5=('OnIce_A_xGoals', 'sum'), off_f5=('OffIce_F_xGoals', 'sum'),
                                  off_a5=('OffIce_A_xGoals', 'sum'), bench5=('timeOnBench', 'sum'))
    out = a.join(f, how='left').fillna({c: 0.0 for c in f.columns})
    out['pos'] = np.where(out['position'].astype(str).str.upper().eq('D'), 'D', 'F')
    out = out.reset_index().rename(columns={'playerId': 'player_id'})
    out['player_id'] = out['player_id'].astype(int)
    out['season'] = out['season'].astype(int)
    out['gp'] = out['gp'].astype(int)
    return out[MP_COLS]


def build_mp_store(seasons, getter=None, path=MP_PATH, pause=2.0):
    """Download MoneyPuck season summaries (one request per season, explicit
    season ids) into the compact committed table.  Seasons already stored and
    not listed in ``seasons`` are kept."""
    import io
    import time
    if getter is None:
        from http_utils import get_text
        getter = lambda y: pd.read_csv(io.StringIO(get_text(MP_URL.format(y=y), timeout=60)))  # noqa: E731
    have = pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=MP_COLS)
    parts = [have[~have['season'].isin(seasons)]] if len(have) else []
    for i, y in enumerate(seasons):
        if i:
            time.sleep(pause)
        parts.append(extract_mp(getter(y)))
    df = pd.concat(parts, ignore_index=True).sort_values(['season', 'player_id'])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    df.to_csv(path, index=False, compression={'method': 'gzip', 'mtime': 0}, float_format='%.3f')
    return df


def load_mp(path=MP_PATH) -> pd.DataFrame:
    return pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=MP_COLS)


def ratings_asof(season) -> pd.Timestamp:
    """Ratings for season S use completed seasons < S only: as of July 1 of S."""
    return pd.Timestamp(int(season), 7, 1)


def player_ratings(mp: pd.DataFrame, season, weights=RATING_SEASON_WEIGHTS, shrink_min=RATING_SHRINK_MIN):
    """Point-in-time skater ratings for ``season``.

    Returns {'values': {pid: xG/60}, 'toi': {pid: prior TOI sec/GP}, 'pos': {pid: F|D},
    'names': {norm name: pid}, 'unrated': {F: v, D: v}, 'asof': Timestamp,
    'data_seasons': [seasons read]}."""
    season = int(season)
    use = [(season - k, w) for k, w in enumerate(weights, start=1)]
    rows = [mp[mp['season'] == s].assign(w=w) for s, w in use if (mp['season'] == s).any()]
    out = {'values': {}, 'toi': {}, 'pos': {}, 'names': {}, 'unrated': {'F': 0.0, 'D': 0.0},
           'asof': ratings_asof(season), 'data_seasons': sorted(int(r['season'].iloc[0]) for r in rows)}
    if not rows:
        return out
    r = pd.concat(rows, ignore_index=True)
    assert int(r['season'].max()) < season, 'a rating may only use completed seasons'
    for c in ('toi5', 'on_f5', 'on_a5', 'off_f5', 'off_a5', 'bench5', 'gp', 'toi_all'):
        r[c] = r[c].astype(float) * r['w']
    r = r.sort_values('season')
    g = r.groupby('player_id').agg(toi5=('toi5', 'sum'), on_f5=('on_f5', 'sum'), on_a5=('on_a5', 'sum'),
                                   off_f5=('off_f5', 'sum'), off_a5=('off_a5', 'sum'), bench5=('bench5', 'sum'),
                                   gp=('gp', 'sum'), toi_all=('toi_all', 'sum'),
                                   pos=('pos', 'last'), name=('name', 'last'))
    on = (g['on_f5'] - g['on_a5']) / g['toi5'].clip(lower=1) * 3600
    off = (g['off_f5'] - g['off_a5']) / g['bench5'].clip(lower=1) * 3600
    rel = np.where(g['toi5'] > 0, on, 0.0) - np.where(g['bench5'] > 0, off, 0.0)
    minutes = g['toi5'] / 60.0
    g = g.assign(rel=rel, v=rel * minutes / (minutes + shrink_min))
    for pos in ('F', 'D'):
        low = g[(g['pos'] == pos) & (g['gp'] < UNRATED_GP) & (g['toi5'] > 0)]
        if len(low):
            # pooled (TOI-weighted) relative impact of fringe players, shrunk the same way
            m = low['toi5'].sum() / 60.0
            out['unrated'][pos] = float(np.average(low['rel'], weights=low['toi5'])) * m / (m + shrink_min)
    out['values'] = {int(p): float(x) for p, x in zip(g.index, g['v'])}
    out['toi'] = {int(p): float(t / n) for p, t, n in zip(g.index, g['toi_all'], g['gp']) if n > 0}
    out['pos'] = {int(p): str(x) for p, x in zip(g.index, g['pos'])}
    out['names'] = {_norm(n): int(p) for p, n in zip(g.index, g['name'])}
    return out


# ═══ Fast track F1: lineup-quality delta feature (shared by training and serving) ═══

def lineup_q(ids, pos, values, toi, unrated):
    """On-ice weighted net xG/60 impact of a lineup: forwards' values weighted
    by expected TOI and scaled to 3 on-ice forwards, defencemen to 2.  Players
    without a rating get their position's unrated value."""
    q = 0.0
    for grp, slots in (('F', 3.0), ('D', 2.0)):
        members = [p for p in ids if pos.get(p, 'F') == grp]
        if not members:
            continue
        w = np.array([toi.get(p, DEFAULT_TOI[grp]) for p in members], float)
        v = np.array([values.get(p, unrated.get(grp, 0.0)) for p in members], float)
        q += slots * float(np.sum(w * v) / np.sum(w))
    return q


class LineupState:
    """Running, point-in-time lineup state: who dressed for each team in its
    recent games, each player's recent TOI, and the season's ratings.

    ``pregame`` only reads games already folded in with ``update_day``; a
    training replay folds a date in AFTER computing that date's features."""

    def __init__(self, mp: pd.DataFrame, baseline_games=BASELINE_GAMES, cross_season=True,
                 min_baseline=MIN_BASELINE_GAMES):
        from collections import deque
        self.mp = mp
        self.baseline_games = baseline_games
        self.cross_season = cross_season
        self.min_baseline = min_baseline
        self.season = None
        self.r = None
        self.team_games = defaultdict(lambda: deque(maxlen=baseline_games))   # team -> (date, season, ids)
        self.player_toi = defaultdict(lambda: deque(maxlen=TOI_HISTORY))     # pid -> toi sec
        self.player_pos = {}
        self.roster_keys = defaultdict(dict)    # team -> {(sweater, last name): pid}
        self.history_max_date = None

    @staticmethod
    def team_key(team):
        return TEAM_ALIASES.get(team, team)

    def ensure_season(self, season):
        season = int(season)
        if self.season != season:
            self.r = player_ratings(self.mp, season)
            self.season = season

    def update_day(self, day_rows: pd.DataFrame):
        """Fold the dressed lineups of one day's completed games."""
        for (gid, team), g in day_rows.groupby(['game_id', 'team'], sort=True):
            sk = g[g['pos'] != 'G']
            d = pd.Timestamp(g['game_date'].iloc[0]).normalize()
            ids = [int(p) for p in sk['player_id']]
            self.team_games[self.team_key(team)].append((d, int(str(gid)[:4]), ids))
            for p, t, pos, num, nm in zip(sk['player_id'], sk['toi_sec'], sk['pos'], sk['sweater'], sk['name']):
                p = int(p)
                if t and t > 0:
                    self.player_toi[p].append(float(t))
                self.player_pos[p] = pos
                last = _norm(nm).split()[-1:] if isinstance(nm, str) else []
                if last and not pd.isna(num):
                    self.roster_keys[self.team_key(team)][(int(num), last[0])] = p
            if self.history_max_date is None or d > self.history_max_date:
                self.history_max_date = d

    def pos_of(self, p):
        return self.player_pos.get(p) or (self.r['pos'].get(p) if self.r else None) or 'F'

    def expected_toi(self, p):
        h = self.player_toi.get(p)
        if h and len(h) >= 3:
            return float(np.mean(h))
        if self.r and p in self.r['toi']:
            return self.r['toi'][p]
        return DEFAULT_TOI[self.pos_of(p)]

    def baseline(self, team, season):
        games = list(self.team_games.get(self.team_key(team), ()))
        if not self.cross_season:
            games = [g for g in games if g[1] == int(season)]
        if len(games) < self.min_baseline:
            return None
        return baseline_lineup([g[2] for g in games])

    def last_lineup(self, team):
        games = self.team_games.get(self.team_key(team))
        return list(games[-1][2]) if games else None

    def side(self, team, season, tonight_ids):
        """{'dq', 'q', 'q_base', 'rated', 'n'} for one team, or None without a baseline."""
        self.ensure_season(season)
        base = self.baseline(team, season)
        if base is None or not tonight_ids:
            return None
        ids = [int(p) for p in tonight_ids][:LINEUP_SIZE]
        allp = set(ids) | set(base)
        pos = {p: self.pos_of(p) for p in allp}
        toi = {p: self.expected_toi(p) for p in allp}
        vals, unr = self.r['values'], self.r['unrated']
        q_t = lineup_q(ids, pos, vals, toi, unr)
        q_b = lineup_q(base, pos, vals, toi, unr)
        return {'dq': q_t - q_b, 'q': q_t, 'q_base': q_b, 'rated': sum(1 for p in ids if p in vals), 'n': len(ids)}

    def pregame(self, home, away, game_date, season, home_ids, away_ids):
        """Feature dict for one game (zeros when a side has no baseline yet)."""
        h = self.side(home, season, home_ids)
        a = self.side(away, season, away_ids)
        ok = h is not None and a is not None
        return {
            'd_lineup': (h['dq'] - a['dq']) if ok else 0.0,
            'd_lineup_level': (h['q'] - a['q']) if ok else 0.0,
            'h_lineup_dq': h['dq'] if h else None, 'a_lineup_dq': a['dq'] if a else None,
            'h_lineup_rated': h['rated'] if h else None, 'a_lineup_rated': a['rated'] if a else None,
            'lineup_ok': bool(ok),
            'ratings_asof': self.r['asof'],
            'ratings_data_max_season': max(self.r['data_seasons']) if self.r['data_seasons'] else None,
            'history_max_date': self.history_max_date,
            'game_date': pd.Timestamp(game_date).normalize(),
        }

    # --- serving: DailyFaceoff names -> NHL ids ---------------------------------
    def resolve(self, team, players, extra_names=None):
        """([NHL id], [unmatched names]) for DailyFaceoff player dicts
        ({name, number}): sweater number + last name on the team's recent
        boxscores first, then MoneyPuck / lookup full names."""
        keys = self.roster_keys.get(self.team_key(team), {})
        names = dict(extra_names or {})
        if self.r:
            names.update(self.r['names'])
        ids, unknown = [], []
        for pl in players:
            nm = pl.get('name') if isinstance(pl, dict) else pl
            num = pl.get('number') if isinstance(pl, dict) else None
            n = _norm(nm or '')
            pid = None
            if n and num is not None:
                try:
                    pid = keys.get((int(num), n.split()[-1]))
                except (TypeError, ValueError):
                    pid = None
            if pid is None and n:
                pid = names.get(n)
            (ids if pid is not None else unknown).append(pid if pid is not None else nm)
        return ids, unknown


def _dfo_skaters(lineup):
    """DailyFaceoff lineup dict -> [{name, number, injuryStatus}] for f1-f4, d1-d3."""
    out = []
    for key in ('f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3'):
        for p in (lineup or {}).get(key) or []:
            if isinstance(p, dict) and p.get('name'):
                out.append(p)
    return out


def serve_lineup_side(st: LineupState, team, season, lineup, injured=None):
    """Tonight's skater ids for one team: DailyFaceoff projected lines minus
    players listed out (DFO injuryStatus or ESPN Out/IR), mapped to NHL ids.
    Coverage gate: >= MIN_MATCHED mapped, else the team's last dressed lineup
    (L-asof, DESIGN §4.2).  Returns (ids, info) or (None, info)."""
    out_names = {_norm(i.get('name', '')) for i in (injured or [])
                 if str(i.get('status', '')).strip().lower() in OUT_STATUSES}
    players = [p for p in _dfo_skaters(lineup)
               if str(p.get('injuryStatus') or '').strip().lower() not in OUT_STATUSES
               and _norm(p['name']) not in out_names]
    ids, unknown = st.resolve(team, players)
    if len(ids) >= MIN_MATCHED:
        return ids, {'source': 'projected', 'matched': len(ids), 'unknown': unknown}
    last = st.last_lineup(team)
    if last:
        return last, {'source': 'last_game', 'matched': len(ids), 'unknown': unknown}
    return None, {'source': None, 'matched': len(ids), 'unknown': unknown}


def serve_lineup_features(st: LineupState, home, away, game_date, home_lineup, away_lineup,
                          injured=None, season=None):
    """F1 lineup features for an upcoming game (same maths as training).
    ``injured`` is {tricode: [{name, status}]} (ESPN)."""
    from season import season_start_year
    gd = pd.Timestamp(game_date).normalize()
    season = int(season) if season is not None else season_start_year(gd.date())
    injured = injured or {}
    h_ids, h_info = serve_lineup_side(st, home, season, home_lineup, injured.get(home))
    a_ids, a_info = serve_lineup_side(st, away, season, away_lineup, injured.get(away))
    f = st.pregame(home, away, gd, season, h_ids or [], a_ids or [])
    f['home'] = {**h_info, 'dq': f['h_lineup_dq'], 'rated': f['h_lineup_rated']}
    f['away'] = {**a_info, 'dq': f['a_lineup_dq'], 'rated': f['a_lineup_rated']}
    return f


def update_current_store(pipeline_dir=SCRIPT_DIR, max_fetch=60, ft_dir=None, getter=None, verbose=True):
    """Gap-driven top-up of this season's lineup store: fetch the boxscores of
    completed current-season games (gamestats file) that are not stored yet,
    at most ``max_fetch`` per run.  Returns the number of games added."""
    from season import START_YEAR, season_file
    p = os.path.join(pipeline_dir, season_file('gamestats', START_YEAR))
    if not os.path.exists(p):
        return 0
    g = pd.read_csv(p, usecols=['game_id'])
    ids = sorted({int(x) for x in g['game_id'] if str(x)[4:6] in ('02', '03')})
    path = lineup_store_path(START_YEAR, ft_dir)
    have = set(pd.read_csv(path, usecols=['game_id'])['game_id'].astype(int)) if os.path.exists(path) else set()
    todo = [x for x in ids if x not in have][:max_fetch]
    if not todo:
        return 0
    n = fetch_lineups(todo, START_YEAR, ft_dir=ft_dir, verbose=False, getter=getter)
    if verbose:
        print(f"  [lineups] stored {n} new {START_YEAR} boxscore lineups ({len(have) + n} games)")
    return n


LINEUP_CROSS_SEASON = True     # baseline may reach into last season's final games (selected on dev folds)


def build_lineup_matrix(store: pd.DataFrame | None = None, mp: pd.DataFrame | None = None,
                        cross_season=None) -> pd.DataFrame:
    """One row per stored game: the lineup features computed from the state
    BEFORE the game's date (L-actual: tonight = the dressed skaters)."""
    store = load_lineup_store() if store is None else store
    mp = load_mp() if mp is None else mp
    cross_season = LINEUP_CROSS_SEASON if cross_season is None else cross_season
    if store.empty:
        return pd.DataFrame(columns=['game_id', 'season', 'd_lineup'])
    st = LineupState(mp, cross_season=cross_season)
    rows = []
    store = store.copy()
    store['game_date'] = pd.to_datetime(store['game_date']).dt.normalize()
    for date, day in store.groupby('game_date', sort=True):
        for gid, g in day.groupby('game_id', sort=True):
            sk = g[g['pos'] != 'G']
            h, a = sk[sk['side'] == 'H'], sk[sk['side'] == 'A']
            if h.empty or a.empty:
                continue
            season = int(str(gid)[:4])
            ht, at = h['team'].iloc[0], a['team'].iloc[0]
            f = st.pregame(ht, at, date, season, list(h['player_id']), list(a['player_id']))
            # L-asof (DESIGN §4.2): tonight = each team's previous dressed lineup
            fa = st.pregame(ht, at, date, season, st.last_lineup(ht) or [], st.last_lineup(at) or [])
            f['d_lineup_asof'] = fa['d_lineup']
            f['game_id'] = int(gid)
            f['season'] = season
            rows.append(f)
        st.update_day(day)
    return pd.DataFrame(rows)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--backtest', action='store_true')
    ap.add_argument('--save-weight', action='store_true')
    a = ap.parse_args()
    if a.backtest:
        rep = backtest()
        if a.save_weight:
            save_weight(rep)
