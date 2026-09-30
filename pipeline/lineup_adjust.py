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


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--backtest', action='store_true')
    ap.add_argument('--save-weight', action='store_true')
    a = ap.parse_args()
    if a.backtest:
        rep = backtest()
        if a.save_weight:
            save_weight(rep)
