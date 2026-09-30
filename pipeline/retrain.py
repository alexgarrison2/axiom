#!/usr/bin/env python3
"""
retrain.py - scheduled retrain with promotion gates, feature ablations and
fitted constants (C4, C10).

Weekly and at season rollover (the workflow owned by B calls
``python3 pipeline/retrain.py``):

1. Build the pregame training matrix with features.py (same code as serving).
2. Train a candidate with train_game_model.train (season-level walk-forward,
   nested C tuning) on the live feature set.
3. Promote it (overwrite game_model.pkl / game_model_meta.json) ONLY if
     - its walk-forward log loss is <= the current model's on every test
       season fold (2023, 2024, 2025; tolerance TOL for re-scored inputs),
     - it beats the home-rate constant by >= 0.01 on every fold,
     - its latest-fold calibration slope is within [0.9, 1.1].
   The decision and every check are written to tests/out/retrain_last.json.

``--roster-prior`` backtests the roster-aware preseason prior (C9) on the
first 15 GP of 2024 and 2025 (tests/out/roster_prior_backtest.json); it
ships only with >= 0.002 early-season log-loss gain in both seasons.

``--ablate`` re-runs the feature ablations (drop-one for live features,
add-one for candidates such as travel / time zones / 3-in-4) and
``--fit-constants`` refits the goal-model and schedule constants with standard
errors; both write their evidence to tests/out/ and the constants to
scoring_coefficients.json (``fitted_constants``).

Decisions use the DEV folds (2023, 2024) only; 2025 is reported as a
hold-out, so the reported 2025 number is not tuned on.

Usage:
    python3 retrain.py                   # candidate + gates (+ promotion)
    python3 retrain.py --dry-run         # gates only, never promote
    python3 retrain.py --ablate --fit-constants --dry-run
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import features as F  # noqa: E402
import goal_model as G  # noqa: E402
import train_game_model as T  # noqa: E402

OUT_DIR = os.path.join(SCRIPT_DIR, 'tests', 'out')
RETRAIN_OUT = os.path.join(OUT_DIR, 'retrain_last.json')
ABLATION_OUT = os.path.join(OUT_DIR, 'feature_ablation.json')
CONSTANTS_OUT = os.path.join(OUT_DIR, 'constants_fit.json')
GOAL_REPLAY_OUT = os.path.join(OUT_DIR, 'goal_model_replay.json')
COEFF_PATH = os.path.join(SCRIPT_DIR, 'scoring_coefficients.json')

DEV_SEASONS = (2023, 2024)
HOLDOUT_SEASON = 2025
TOL = 0.0005                 # allowed log-loss slack vs the current model (input re-scoring noise)
MIN_GAIN_VS_HOME_RATE = 0.01
CAL_SLOPE_RANGE = (0.9, 1.1)
N_BOOT = 200

CANDIDATE_GROUPS = {
    'travel_km': ['d_travel_km'],
    'time_zone_shift': ['h_tz_shift', 'a_tz_shift'],
    'three_in_four': ['h_3in4', 'a_3in4'],
    'special_teams_xg': ['d_st'],
}


def _now():
    return datetime.now(timezone.utc)


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2, default=float)


def _ll_vec(y, p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


# ─── Walk-forward helpers ─────────────────────────────────────────────────────

def walk(M, cols, **kw):
    folds, oos = T.walk_forward(M, list(cols), **kw)
    return {f['test_season']: f for f in folds}, oos


def compare(oos_a, oos_b, seasons):
    """Mean per-game log-loss difference (b - a) over ``seasons`` with its
    paired standard error.  Negative = b is better."""
    a = oos_a[oos_a['season'].isin(seasons)][['game_id', 'home_win', 'p_model']]
    b = oos_b[oos_b['season'].isin(seasons)][['game_id', 'p_model']].rename(columns={'p_model': 'p_b'})
    m = a.merge(b, on='game_id')
    d = _ll_vec(m['home_win'], m['p_b']) - _ll_vec(m['home_win'], m['p_model'])
    return float(d.mean()), float(d.std(ddof=1) / math.sqrt(len(d))), int(len(d))


def ablation(M, base):
    """Drop-one for live features, add-one for candidate groups."""
    base_folds, base_oos = walk(M, base)
    rows = []

    def record(name, kind, cols, members):
        folds, oos = walk(M, cols)
        dev_d, dev_se, n_dev = compare(base_oos, oos, DEV_SEASONS)
        ho_d, ho_se, n_ho = compare(base_oos, oos, (HOLDOUT_SEASON,))
        if kind == 'drop':
            # the live model is the status quo: drop only on evidence (> 1 paired SE)
            keep = not (dev_d < -dev_se)
            decision = 'keep' if keep else 'drop (removal lowers dev log loss by > 1 SE)'
        else:
            # a candidate must improve dev log loss by more than one paired SE
            keep = dev_d < -dev_se
            decision = 'add' if keep else 'reject (dev gain not > 1 SE)'
        rows.append({'name': name, 'kind': kind, 'features': members,
                     'fold_log_loss': {str(s): folds[s]['log_loss'] for s in folds},
                     'dev_delta': dev_d, 'dev_se': dev_se, 'n_dev': n_dev,
                     'holdout_delta': ho_d, 'holdout_se': ho_se, 'n_holdout': n_ho,
                     'decision': decision, 'kept': bool(keep)})
        print(f"  {kind:4s} {name:22s} dev {dev_d:+.5f} (se {dev_se:.5f}) holdout {ho_d:+.5f} -> {decision}")

    for c in base:
        record(c, 'drop', [x for x in base if x != c], [c])
    for g, members in CANDIDATE_GROUPS.items():
        record(g, 'add', base + members, members)
    return {'generated_at': _now().isoformat(), 'base_features': base,
            'base_fold_log_loss': {str(s): base_folds[s]['log_loss'] for s in base_folds},
            'dev_seasons': list(DEV_SEASONS), 'holdout_season': HOLDOUT_SEASON,
            'rule': ('changes need evidence: drop a live feature only when removing it lowers dev log loss '
                     'by more than one paired SE; add a candidate only when it lowers dev log loss by more '
                     'than one paired SE. The promotion gates then check every fold incl. the hold-out.'),
            'results': rows}


def select_features(M, base, candidates=CANDIDATE_GROUPS):
    """Stepwise selection on the DEV folds with the one-paired-SE rule:
    backward (drop the feature whose removal helps most, if by > 1 SE), then
    forward over candidate groups (add the group that helps most, if > 1 SE)."""
    cols = list(base)
    steps = []
    _, cur_oos = walk(M, cols)
    while len(cols) > 1:
        best = None
        for c in cols:
            _, oos = walk(M, [x for x in cols if x != c])
            d, se, _ = compare(cur_oos, oos, DEV_SEASONS)
            if best is None or d + se < best[1] + best[2]:
                best = (c, d, se, oos)
        if not best[1] < -best[2]:
            break
        cols.remove(best[0])
        cur_oos = best[3]
        steps.append({'action': 'drop', 'feature': best[0], 'dev_delta': best[1], 'dev_se': best[2]})
        print(f"  select: drop {best[0]} (dev {best[1]:+.5f}, se {best[2]:.5f})")
    remaining = dict(candidates)
    while remaining:
        best = None
        for g, members in remaining.items():
            _, oos = walk(M, cols + members)
            d, se, _ = compare(cur_oos, oos, DEV_SEASONS)
            if best is None or d + se < best[1] + best[2]:
                best = (g, d, se, oos)
        if not best[1] < -best[2]:
            break
        cols += remaining.pop(best[0])
        cur_oos = best[3]
        steps.append({'action': 'add', 'feature': best[0], 'dev_delta': best[1], 'dev_se': best[2]})
        print(f"  select: add {best[0]} (dev {best[1]:+.5f}, se {best[2]:.5f})")
    return cols, steps


# ─── Constants ────────────────────────────────────────────────────────────────

def bootstrap_logit(M, cols, C, n=N_BOOT, seed=5):
    """Raw-scale coefficients and home-ice logit with bootstrap SEs."""
    usable = M[~M['burn_in']].reset_index(drop=True)
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(n):
        idx = rng.integers(0, len(usable), len(usable))
        m = T.fit_logit(usable.iloc[idx], cols, C)
        betas, h = T.explain_coefficients(m, cols)
        draws.append([h] + [betas[c] for c in cols])
    draws = np.array(draws)
    m = T.fit_logit(usable, cols, C)
    betas, h = T.explain_coefficients(m, cols)
    est = [h] + [betas[c] for c in cols]
    return {name: {'value': float(v), 'se': float(draws[:, i].std(ddof=1))}
            for i, (name, v) in enumerate(zip(['home_ice_logit'] + list(cols), est))}


def home_ice_ablation(M, cols):
    """Walk-forward with the intercept removed (a symmetric model)."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    orig = T.fit_logit

    def no_intercept(train, c, C):
        m = make_pipeline(StandardScaler(with_mean=False), LogisticRegression(C=C, fit_intercept=False, max_iter=1000))
        m.fit(train[c].values, train['home_win'].values)
        return m
    base_folds, base_oos = walk(M, cols)
    T.fit_logit = no_intercept
    try:
        folds, oos = walk(M, cols)
    finally:
        T.fit_logit = orig
    dev_d, dev_se, _ = compare(base_oos, oos, DEV_SEASONS)
    ho_d, ho_se, _ = compare(base_oos, oos, (HOLDOUT_SEASON,))
    return {'without_fold_log_loss': {str(s): folds[s]['log_loss'] for s in folds},
            'with_fold_log_loss': {str(s): base_folds[s]['log_loss'] for s in base_folds},
            'dev_delta_without': dev_d, 'dev_se': dev_se, 'holdout_delta_without': ho_d, 'holdout_se': ho_se,
            'kept': bool(dev_d > dev_se)}


def fit_ot_share(M):
    """Share of games tied after regulation that end in 3v3 OT (rest: shootout)."""
    x = M[M['decision'] != 'REG']
    k, n = int((x['decision'] == 'OT').sum()), int(len(x))
    p = k / n
    by = {str(s): float((g['decision'] == 'OT').mean()) for s, g in x.groupby('season')}
    return {'value': p, 'se': math.sqrt(p * (1 - p) / n), 'n': n, 'by_season': by,
            'replaces': 'hand-set 0.70/0.30 OT/SO split in predict_games.simulate_game'}


def ot_ablation(M, oos, train_seasons=(2022, 2023, 2024), test_season=HOLDOUT_SEASON):
    """Hold-out check of the OT constants on 2025 games tied after regulation.

    * OT vs SO: binomial log loss with the share fitted on 2022-2024, the old
      hand constant 0.70 and a coin flip.
    * Home win in OT: goal_model's matchup-dependent p_ot (from the
      out-of-sample win probability) vs a constant home rate vs 0.5."""
    x = M[M['decision'] != 'REG']
    tr, te = x[x['season'].isin(train_seasons)], x[x['season'] == test_season]
    y = (te['decision'] == 'OT').astype(int).values
    share = float((tr['decision'] == 'OT').mean())
    ll = lambda p: float(_ll_vec(y, np.full(len(y), p)).mean())
    ot_part = {'fitted_2022_2024': {'value': share, 'log_loss': ll(share)},
               'hand_0.70': {'value': 0.70, 'log_loss': ll(0.70)}, 'coin_flip': {'log_loss': ll(0.5)}, 'n': int(len(y))}
    ot = te[te['decision'] == 'OT'].merge(oos[['game_id', 'p_model']], on='game_id')
    shr = share
    p_ot = []
    for p, lg, pc in zip(ot['p_model'], ot['league_gpg'], ot['pace']):
        lh, la = G.goal_rates(p, G.expected_total(lg, pc), shr)
        p_ot.append(0.5 + shr * (lh / (lh + la) - 0.5))
    yh = ot['home_win'].values
    const = float(tr[tr['decision'] == 'OT']['home_win'].mean())
    home_part = {'goal_model_matchup': float(_ll_vec(yh, p_ot).mean()),
                 'constant_2022_2024': {'value': const, 'log_loss': float(_ll_vec(yh, np.full(len(yh), const)).mean())},
                 'hand_0.536': float(_ll_vec(yh, np.full(len(yh), 0.536)).mean()),
                 'coin_flip': float(_ll_vec(yh, np.full(len(yh), 0.5)).mean()), 'n': int(len(yh))}
    return {'ot_vs_so': ot_part, 'home_win_in_ot': home_part}


def fit_ot_home_rate(M):
    x = M[M['decision'] != 'REG']
    out = {}
    for d in ('OT', 'SO'):
        g = x[x['decision'] == d]
        p = float(g['home_win'].mean())
        out[d] = {'value': p, 'se': math.sqrt(p * (1 - p) / len(g)), 'n': int(len(g))}
    return out


def _total_dev(y, mu):
    y = np.asarray(y, float)
    mu = np.asarray(mu, float)
    with np.errstate(divide='ignore', invalid='ignore'):
        t = np.where(y > 0, y * np.log(y / mu), 0.0)
    return float(2 * np.mean(t - (y - mu)))


def _totals_frame(M):
    x = M[['game_id', 'season', 'league_gpg', 'pace', 'home_goals', 'away_goals']].dropna().copy()
    x['total'] = x['home_goals'] + x['away_goals']     # SO 'goal' is not in the file
    return x


def fit_total_model(M, train_seasons=(2022, 2023, 2024), test_season=HOLDOUT_SEASON, seed=9):
    """Fit total_pace_weight and total_scale of goal_model.expected_total by
    Poisson deviance on train seasons; report the hold-out season."""
    x = _totals_frame(M)
    tr, te = x[x['season'].isin(train_seasons)], x[x['season'] == test_season]
    W = np.round(np.arange(0, 1.01, 0.05), 2)
    S = np.round(np.arange(0.9, 1.101, 0.005), 3)

    def best(d):
        lg, pc, y = d['league_gpg'].values, d['pace'].values, d['total'].values
        res = min(((_total_dev(y, lg * s * (1 + w * (pc - 1))), w, s) for w in W for s in S))
        return res[1], res[2]
    w, s = best(tr)
    rng = np.random.default_rng(seed)
    boots = [best(tr.iloc[rng.integers(0, len(tr), len(tr))]) for _ in range(40)]
    bw, bs = np.array(boots).T

    def evaluate(d, w_, s_):
        mu = d['league_gpg'].values * s_ * (1 + w_ * (d['pace'].values - 1))
        return {'deviance': _total_dev(d['total'].values, mu), 'mean_pred': float(mu.mean()),
                'mean_actual': float(d['total'].mean()), 'bias': float(mu.mean() - d['total'].mean())}
    return {
        'total_pace_weight': {'value': float(w), 'se': float(bw.std(ddof=1))},
        'total_scale': {'value': float(s), 'se': float(bs.std(ddof=1))},
        'train_seasons': list(train_seasons), 'holdout_season': test_season,
        'holdout_fitted': evaluate(te, w, s),
        'holdout_no_pace': evaluate(te, 0.0, s),
        'holdout_defaults': evaluate(te, 0.5, 1.0),
        'pace_kept': bool(evaluate(te, w, s)['deviance'] <= evaluate(te, 0.0, s)['deviance']),
    }


def goal_model_replay(M, oos, season=HOLDOUT_SEASON):
    """C5: xG favourite vs win% favourite and predicted vs actual totals on a
    walk-forward replay (out-of-sample win probabilities)."""
    x = M[M['season'] == season].merge(oos[['game_id', 'p_model']], on='game_id')
    T_ = np.array([G.expected_total(l, p) for l, p in zip(x['league_gpg'], x['pace'])])
    xg = np.array([G.display_xg(p, t) for p, t in zip(x['p_model'], T_)])
    shown = xg.sum(axis=1)
    actual = (x['home_goals'] + x['away_goals']).values
    return {
        'season': f"{season}-{str(season + 1)[2:]}", 'n': int(len(x)),
        'xg_favourite_differs_from_win_favourite': float(np.mean((xg[:, 0] > xg[:, 1]) != (x['p_model'].values > 0.5))),
        'mean_predicted_total': float(shown.mean()), 'mean_actual_total': float(actual.mean()),
        'total_bias': float(shown.mean() - actual.mean()),
        'total_corr': float(np.corrcoef(shown, actual)[0, 1]),
        'baseline_before': {'xg_favourite_differs_share': 0.181, 'total_bias': 0.36,
                            'source': 'audit:model-quality on 421 live 2025-26 games'},
        'coefficients': {k: G._coeff(k) for k in ('ot_decided_share', 'total_pace_weight', 'total_scale')},
    }


def save_fitted_constants(constants):
    with open(COEFF_PATH) as f:
        c = json.load(f)
    fitted = c.get('fitted_constants', {})
    fitted.update(constants)
    c['fitted_constants'] = fitted
    c['_notes'] = ('fitted_constants and the ot_/total_/market_ keys are written by retrain.py / market.py '
                   'with standard errors and ablations (tests/out/constants_fit.json). xg_5v5_coeff, pp_opp_val, '
                   'pk_opp_cost, b2b_cost_*, 3in4_cost_*, home_ice_* are read only by the legacy Poisson path in '
                   'predict_games.py and go away when it switches to ml_predict + market (A10).')
    # goal_model reads these three top-level keys
    for k in ('ot_decided_share', 'total_pace_weight', 'total_scale'):
        if k in constants:
            c[k] = {'value': round(constants[k]['value'], 4), 'se': round(constants[k]['se'], 4),
                    'fit': constants[k].get('fit', 'retrain.py --fit-constants')}
    with open(COEFF_PATH, 'w') as f:
        json.dump(c, f, indent=2)


def fit_constants(M, cols, ablation_report=None):
    usable = M[~M['burn_in']]
    C, _ = T.tune_C(usable, cols)
    _, oos = walk(M, cols)
    ota = ot_ablation(M, oos)
    boot = bootstrap_logit(M, cols, C)
    hi = home_ice_ablation(M, cols)
    ot = fit_ot_share(M)
    oth = fit_ot_home_rate(M)
    tot = fit_total_model(M)
    now = _now().isoformat()
    constants = {
        'home_ice_logit': {**boot['home_ice_logit'], 'fit': 'logistic intercept (bootstrap SE)',
                           'ablation': hi, 'replaces': 'HOME_ICE_VAL 0.16 xG (predict_games Poisson path)'},
        'ot_decided_share': {**{k: ot[k] for k in ('value', 'se')}, 'n': ot['n'], 'by_season': ot['by_season'],
                             'fit': 'OT / (OT + SO) over tied-after-regulation games 2022-2025', 'replaces': ot['replaces'],
                             'ablation': ota['ot_vs_so']},
        'ot_home_win_rate': {**oth['OT'], 'fit': 'home win share of OT-decided games',
                             'note': 'goal_model makes this matchup-dependent: 0.5 + ot_share * (r - 0.5)',
                             'ablation': ota['home_win_in_ot']},
        'so_home_win_rate': {**oth['SO'], 'fit': 'home win share of shootouts', 'used_by_model': False,
                             'note': 'goal_model treats a shootout as a coin flip; 0.496 +/- 0.026 supports that'},
        'total_pace_weight': {**tot['total_pace_weight'], 'fit': 'Poisson deviance of game totals, 2022-2024',
                              'ablation': {'holdout_fitted': tot['holdout_fitted'], 'holdout_no_pace': tot['holdout_no_pace'],
                                           'kept': tot['pace_kept']}},
        'total_scale': {**tot['total_scale'], 'fit': 'Poisson deviance of game totals, 2022-2024',
                        'ablation': {'holdout_fitted': tot['holdout_fitted'], 'holdout_defaults': tot['holdout_defaults']}},
    }
    drop = {r['features'][0]: r for r in (ablation_report or {}).get('results', []) if r['kind'] == 'drop'}
    for c in cols:
        constants[f'beta_{c}'] = {**boot[c], 'fit': 'logistic coefficient on the raw feature (bootstrap SE)'}
        if c in drop:
            r = drop[c]
            constants[f'beta_{c}']['ablation'] = {k: r[k] for k in ('dev_delta', 'dev_se', 'holdout_delta',
                                                                     'holdout_se', 'decision')}
    if 'beta_d_goalie_gsax' in constants:
        constants['beta_d_goalie_gsax']['replaces'] = 'GOALIE_IMPACT_FACTOR 1.0 (predict_games Poisson path)'
    for k in ('beta_h_b2b', 'beta_a_b2b'):
        if k in constants:
            constants[k]['replaces'] = 'b2b_cost_gf / b2b_cost_ga (predict_games Poisson path)'
    for v in constants.values():
        v['fitted_at'] = now
    report = {'generated_at': now, 'model_C': C, 'features': cols, 'constants': constants,
              'total_model': tot,
              'policy_constants': {
                  'MIN_EV': 'market.py 0.03 - betting policy threshold (not fitted)',
                  'KELLY_FRACTION': 'market.py 0.25 - documented quarter Kelly (not fitted)',
                  'ROI_CI_FLOOR / ROLLING_N / MIN_TEAM_GP': 'market.py gate policy (not fitted)',
                  'market_blend_weight': 'fitted by market.py --backtest (tests/out/market_backtest.json)',
              }}
    return report


# ─── Roster-aware preseason prior (C9) ───────────────────────────────────────

ROSTER_TOP = 18
ROSTER_DECAY_GP = 30          # the roster term fades out over a team's first 30 GP


def player_values(pipeline_dir=SCRIPT_DIR):
    """Per (player, season): individual raw xG per game with an event, all
    situations, NHL games only (a free, shot-level offensive value)."""
    import shooting_talent as ST
    from season import season_file, START_YEAR
    files = [os.path.join(pipeline_dir, 'nhl_historical_shots.csv')] + \
        [os.path.join(pipeline_dir, season_file('shots', y)) for y in (START_YEAR - 1, START_YEAR)]
    parts = []
    for f in dict.fromkeys(files):
        if not os.path.exists(f):
            continue
        d = pd.read_csv(f, low_memory=False)
        if d.empty:
            continue
        d = d[d['game_id'].astype(str).str[4:6].isin(F.NHL_GAME_TYPES)]
        d = d.assign(xg_raw=ST._raw_xg(d, pipeline_dir))
        parts.append(d[['game_id', 'team_id', 'player_id', 'xg_raw', 'strength_state']])
    sh = pd.concat(parts, ignore_index=True).drop_duplicates()
    sh = sh[sh['strength_state'] != 'EmptyNet']
    sh['season'] = sh['game_id'].map(F.season_of)
    sh['player_id'] = pd.to_numeric(sh['player_id'], errors='coerce')
    sh = sh.dropna(subset=['player_id'])
    sh['player_id'] = sh['player_id'].astype(int)
    per = sh.groupby(['player_id', 'season']).agg(ixg=('xg_raw', 'sum'), gp=('game_id', 'nunique')).reset_index()
    per['value'] = per['ixg'] / per['gp']
    return sh, per


def roster_deltas(sh, per, team_ids, first_games=5, last_games=20):
    """{(season, team): change in summed prior-season value between the team's
    opening roster (skaters with an event in its first ``first_games``) and
    its roster at the end of last season (last ``last_games``), top 18 each.
    Players without a prior season get a replacement value."""
    val = {(r.player_id, r.season): r.value for r in per.itertuples(index=False)}
    repl = {s: float(g.loc[g['gp'] >= 20, 'value'].quantile(0.1)) for s, g in per.groupby('season')}
    g_order = sh[['game_id', 'team_id', 'season']].drop_duplicates().sort_values('game_id')
    out = {}
    for (season, tid), g in g_order.groupby(['season', 'team_id']):
        prev = g_order[(g_order['season'] == season - 1) & (g_order['team_id'] == tid)]
        if prev.empty:
            continue
        open_ids = sh[sh['game_id'].isin(g['game_id'].head(first_games)) & (sh['team_id'] == tid)]
        end_ids = sh[sh['game_id'].isin(prev['game_id'].tail(last_games)) & (sh['team_id'] == tid)]

        def top(x):
            return x.groupby('player_id')['game_id'].nunique().sort_values(ascending=False).head(ROSTER_TOP).index

        def total(ids):
            return float(sum(val.get((p, season - 1), repl.get(season - 1, 0.0)) for p in ids))
        new_r, old_r = top(open_ids), top(end_ids)
        out[(int(season), team_ids.get(int(tid)))] = {
            'delta': total(new_r) - total(old_r),
            'added': [int(p) for p in new_r if p not in set(old_r)],
            'lost': [int(p) for p in old_r if p not in set(new_r)],
        }
    return out


def roster_prior_backtest(M, cols, out_path=os.path.join(OUT_DIR, 'roster_prior_backtest.json')):
    sh, per = player_values()
    team_ids = F.load_team_ids()
    deltas = roster_deltas(sh, per, team_ids)
    M = M.copy()

    def d(season, team):
        r = deltas.get((int(season), F.franchise(team))) or deltas.get((int(season), team))
        return r['delta'] if r else 0.0
    fade_h = np.clip(1 - M['h_gp'] / ROSTER_DECAY_GP, 0, 1)
    fade_a = np.clip(1 - M['a_gp'] / ROSTER_DECAY_GP, 0, 1)
    M['d_roster'] = [d(s, h) * fh - d(s, a) * fa for s, h, a, fh, fa in
                     zip(M['season'], M['home'], M['away'], fade_h, fade_a)]
    base_f, base_oos = walk(M, cols)
    new_f, new_oos = walk(M, cols + ['d_roster'])
    res = {}
    for S in (2024, 2025):
        a = base_oos[(base_oos['season'] == S) & base_oos['early']]
        b = new_oos[(new_oos['season'] == S) & new_oos['early']]
        la = float(_ll_vec(a['home_win'], a['p_model']).mean())
        lb = float(_ll_vec(b['home_win'], b['p_model']).mean())
        res[str(S)] = {'n_early': int(len(a)), 'base_log_loss': la, 'with_roster_log_loss': lb, 'improvement': la - lb}
    ship = all(v['improvement'] >= 0.002 for v in res.values())
    rep = {'generated_at': _now().isoformat(),
           'method': ('roster value = sum over the top-18 opening skaters (events in the first 5 games) of '
                      'last-season individual raw xG per game, minus the same for last season\'s closing '
                      'roster; replacement value (10th pct) for players without a prior season; the '
                      'difference enters as d_roster, fading to 0 by 30 GP. Walk-forward (train < S), '
                      'games where either team has <= 15 GP.'),
           'caveat': ('offense-only value (shot-level data has no historical shifts for RAPM); the opening '
                      'roster uses games 1-5, a slight look-ahead for games 2-5 lineups (not results)'),
           'folds': res, 'rule': 'ship only if early-season log loss improves by >= 0.002 in both 2024 and 2025',
           'enabled': ship,
           'decision': 'enabled' if ship else 'disabled: improvement below 0.002 in at least one season'}
    _write(out_path, rep)
    print(f"[roster prior] {res} -> {rep['decision']}")
    return rep


# ─── Promotion ────────────────────────────────────────────────────────────────

def promotion_checks(cand_meta, cur_meta):
    checks, ok = [], True
    cur = {f['test_season']: f for f in (cur_meta or {}).get('cv_results', [])}
    for f in cand_meta['cv_results']:
        s = f['test_season']
        c = cur.get(s)
        if c is not None:
            passed = f['log_loss'] <= c['log_loss'] + TOL
            checks.append({'check': f'{s} fold log loss <= current + {TOL}', 'candidate': f['log_loss'],
                           'current': c['log_loss'], 'passed': passed})
            ok &= passed
        gain = f['home_rate_baseline']['log_loss'] - f['log_loss']
        passed = gain >= MIN_GAIN_VS_HOME_RATE
        checks.append({'check': f'{s} beats home-rate by >= {MIN_GAIN_VS_HOME_RATE}', 'gain': gain, 'passed': passed})
        ok &= passed
    last = max(cand_meta['cv_results'], key=lambda f: f['test_season'])
    slope = last['calibration_slope']
    passed = slope is not None and CAL_SLOPE_RANGE[0] <= slope <= CAL_SLOPE_RANGE[1]
    checks.append({'check': f"{last['test_season']} calibration slope in {list(CAL_SLOPE_RANGE)}",
                   'slope': slope, 'passed': passed})
    ok &= passed
    return bool(ok), checks


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='evaluate gates, never promote')
    ap.add_argument('--ablate', action='store_true', help='run feature ablations (tests/out/feature_ablation.json)')
    ap.add_argument('--select', action='store_true', help='stepwise feature selection on the dev folds')
    ap.add_argument('--fit-constants', action='store_true', help='refit constants into scoring_coefficients.json')
    ap.add_argument('--no-legacy', action='store_true', help='skip the legacy XGB baseline')
    ap.add_argument('--strict', action='store_true', help='exit 1 when the gates fail (CI)')
    ap.add_argument('--roster-prior', action='store_true', help='backtest the roster-aware preseason prior (C9)')
    args = ap.parse_args(argv)

    with open(T.META_PATH) as f:
        cur_meta = json.load(f)
    cols = list(cur_meta.get('feature_columns') or F.FEATURE_COLUMNS)
    M, xg_source = T.build_matrix()
    print(f"[retrain] {len(M)} games, live features {cols}")

    if args.roster_prior:
        roster_prior_backtest(M, cols)
    abl = None
    if args.ablate:
        abl = ablation(M, cols)
        _write(ABLATION_OUT, abl)
    if args.fit_constants:        # constants of the LIVE feature set
        rep = fit_constants(M, cols, abl)
        _write(CONSTANTS_OUT, rep)
        if not args.dry_run:
            save_fitted_constants(rep['constants'])
    selection = None
    if args.select:
        sel, steps = select_features(M, cols)
        selection = {'from': cols, 'to': sel, 'steps': steps}
        cols = sel

    model, meta, oos = T.train(cols=cols, save=False, legacy=not args.no_legacy, verbose=True,
                               M=M, xg_source=xg_source)
    if selection:
        meta['feature_selection'] = selection
    ok, checks = promotion_checks(meta, cur_meta)
    promoted = bool(ok and not args.dry_run)
    if promoted:
        meta['promotion'] = {'promoted_at': _now().isoformat(), 'replaced': cur_meta.get('model_version'),
                             'checks': checks}
        T.save_model(model, meta)
    if len(oos):
        _write(GOAL_REPLAY_OUT, goal_model_replay(M, oos))
    out = {'generated_at': _now().isoformat(), 'candidate_version': meta['model_version'],
           'current_version': cur_meta.get('model_version'), 'features': cols,
           'gates_passed': ok, 'promoted': promoted, 'dry_run': args.dry_run, 'checks': checks,
           'candidate_folds': [{k: f.get(k) for k in ('test_season', 'n', 'log_loss', 'brier', 'accuracy',
                                                        'calibration_slope', 'mean_pred_home', 'actual_home')}
                               for f in meta['cv_results']]}
    _write(RETRAIN_OUT, out)
    print(f"[retrain] gates {'PASS' if ok else 'FAIL'}; promoted={promoted}")
    for c in checks:
        print(f"   {'ok ' if c['passed'] else 'NO '} {c['check']}")
    return 1 if (args.strict and not ok) else 0


if __name__ == '__main__':
    sys.exit(main())
