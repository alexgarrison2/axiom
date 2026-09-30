#!/usr/bin/env python3
"""
train_game_model.py - regularised logistic game model with an Elo prior (v5).

Replaces the 24-feature XGBoost model (v4), which a 6-feature logistic
regression beat in every walk-forward fold.  Features come from the shared
``features.py`` builder (the same code the live predictor uses):

    d_xg_share, d_xg_share_all  5v5 / all-situations xG-share EWMAs, regressed
                                50% toward the mean at each season boundary
    d_elo                       goals + xG Elo, 50% offseason regression
    d_goalie_gsax               starters' regressed GSAx/game (in-season xG
                                normalisation, empty net excluded)
    d_pts_pct                   shrunk points%  (pts/2 + 10) / (GP + 20)
    h_b2b, a_b2b, d_rest        schedule
    intercept                   the fitted home-ice advantage

Evaluation is season-level walk-forward: for each test season S the model is
trained on seasons < S only, with the L2 strength C chosen on an inner split
(train < S-1, validate S-1).  Reported per fold: log loss, Brier, accuracy,
mean predicted vs actual home win, calibration slope, early-season log loss
(either team <= 15 GP), plus two baselines: the home-rate constant and the
legacy XGB model (legacy_xgb.py) on the same games.

Usage:
    python3 train_game_model.py            # walk-forward + fit + save
    python3 train_game_model.py --no-save  # evaluate only
    python3 train_game_model.py --no-legacy  # skip the (slow) XGB baseline

Output:
    game_model.pkl, game_model_meta.json   (only when saving)
    cache/walkforward_oos.csv              out-of-sample predictions per game
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import sys
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings('ignore')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import features as F  # noqa: E402

MODEL_FAMILY = 'logit-elo'
MODEL_GENERATION = 5
C_GRID = (0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0)
DEFAULT_C = 0.01         # prior choice when no validation season exists
TEST_SEASONS = (2023, 2024, 2025)
BURN_IN_GP = 20          # first season in the data has no prior: skip its first 20 GP
EARLY_GP = 15            # "early season" = either team's game number <= 15

MODEL_PATH = os.path.join(SCRIPT_DIR, 'game_model.pkl')
META_PATH = os.path.join(SCRIPT_DIR, 'game_model_meta.json')
OOS_PATH = os.path.join(F.CACHE_DIR, 'walkforward_oos.csv')


# ─── Data ─────────────────────────────────────────────────────────────────────

def build_matrix(current_df=None, use_raw_xg=True):
    games, xg_source = F.load_feature_games(current_df=current_df, use_raw_xg=use_raw_xg)
    M = F.build_training_matrix(games)
    M['early'] = (M['team_game_number_h'] <= EARLY_GP) | (M['team_game_number_a'] <= EARLY_GP)
    first = M['season'].min()
    M['burn_in'] = (M['season'] == first) & ((M['h_gp'] < BURN_IN_GP) | (M['a_gp'] < BURN_IN_GP))
    return M, xg_source


# ─── Metrics ──────────────────────────────────────────────────────────────────

def _clip(p):
    return np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)


def calibration_slope(y, p):
    """Slope/intercept of a logistic recalibration of y on logit(p).
    1.0 / 0.0 = perfectly calibrated; < 1 = overconfident."""
    p = _clip(p)
    z = np.log(p / (1 - p)).reshape(-1, 1)
    lr = LogisticRegression(C=1e6).fit(z, y)
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def reliability(y, p, bins=10):
    """10 equal-width bins on [0,1] of home-win probability: n, mean p, actual rate."""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        out.append({'bin': b, 'lo': float(edges[b]), 'hi': float(edges[b + 1]), 'n': int(m.sum()),
                    'mean_pred': float(p[m].mean()) if m.any() else None,
                    'actual': float(y[m].mean()) if m.any() else None})
    return out


def reliability_ols_slope(y, p, bins=10):
    """Weighted OLS slope of actual rate on mean prediction over populated bins."""
    rows = [r for r in reliability(y, p, bins) if r['n'] > 0]
    if len(rows) < 2:
        return None
    x = np.array([r['mean_pred'] for r in rows]); a = np.array([r['actual'] for r in rows])
    w = np.array([r['n'] for r in rows], dtype=float)
    xm, am = np.average(x, weights=w), np.average(a, weights=w)
    return float(np.sum(w * (x - xm) * (a - am)) / np.sum(w * (x - xm) ** 2))


def metrics(y, p):
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    if len(y) == 0:
        return {'n': 0}
    slope, icpt = calibration_slope(y, p) if len(set(y)) > 1 else (None, None)
    return {
        'n': int(len(y)),
        'log_loss': float(log_loss(y, _clip(p), labels=[0, 1])),
        'brier': float(brier_score_loss(y, p)),
        'accuracy': float(np.mean((p >= 0.5) == (y == 1))),
        'mean_pred_home': float(p.mean()),
        'actual_home': float(y.mean()),
        'calibration_slope': slope,
        'calibration_intercept': icpt,
        'reliability_slope': reliability_ols_slope(y, p),
    }


# ─── Model ────────────────────────────────────────────────────────────────────

def fit_logit(train: pd.DataFrame, cols, C):
    m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=1000))
    m.fit(train[cols].values, train['home_win'].values)
    return m


def tune_C(train: pd.DataFrame, cols, grid=C_GRID, default=DEFAULT_C):
    """Nested walk-forward choice of the L2 strength C using only ``train``.

    Every season v in ``train`` that has an earlier season is a validation
    season (fit on seasons < v).  Per-game log losses are pooled and the
    one-standard-error rule picks the MOST regularised C whose pooled log loss
    is within one paired SE of the best (Breiman et al.), which keeps probabilities
    from being overconfident when a season's signal is weaker than usual.
    With no validation season available the prior default C is used."""
    seasons = sorted(train['season'].unique())
    val_seasons = seasons[1:]
    if not val_seasons:
        return default, {}
    per_c = {}
    for C in grid:
        losses = []
        for v in val_seasons:
            tr, va = train[train['season'] < v], train[train['season'] == v]
            if len(tr) < 200 or len(va) == 0:
                continue
            p = _clip(fit_logit(tr, cols, C).predict_proba(va[cols].values)[:, 1])
            yv = va['home_win'].values
            losses.append(-(yv * np.log(p) + (1 - yv) * np.log(1 - p)))
        if losses:
            per_c[C] = np.concatenate(losses)
    if not per_c:
        return default, {}
    means = {C: float(v.mean()) for C, v in per_c.items()}
    best = min(means, key=means.get)
    # Paired SE: the same games are scored under every C, so the noise that
    # matters is in the per-game DIFFERENCE from the best C, not in the loss
    # itself (whose SE, ~0.004, would make the rule pick an underfit model).
    se_diff = {C: float((v - per_c[best]).std(ddof=1) / np.sqrt(len(v))) for C, v in per_c.items()}
    chosen = min(C for C in per_c if means[C] - means[best] <= se_diff[C])
    return chosen, {**means, 'best': best, 'se_paired': se_diff}


def walk_forward(M: pd.DataFrame, cols, test_seasons=TEST_SEASONS, C=None):
    folds, oos = [], []
    usable = M[~M['burn_in']]
    for S in test_seasons:
        tr, te = usable[usable['season'] < S], M[M['season'] == S]
        if len(tr) < 200 or len(te) < 100:
            continue
        c_used, c_scores = (C, {}) if C is not None else tune_C(tr, cols)
        model = fit_logit(tr, cols, c_used)
        p = model.predict_proba(te[cols].values)[:, 1]
        y = te['home_win'].values
        home_const = float(tr['home_win'].mean())
        e = te['early'].values
        fold = {'test_season': int(S), 'C': c_used, 'train_n': int(len(tr)),
                **metrics(y, p),
                'early': metrics(y[e], p[e]),
                'home_rate_baseline': {'rate': home_const,
                                       'log_loss': float(log_loss(y, np.full(len(y), home_const), labels=[0, 1])),
                                       'early_log_loss': float(log_loss(y[e], np.full(e.sum(), home_const), labels=[0, 1])) if e.any() else None},
                'inner_C_scores': {str(k): v for k, v in c_scores.items()}}
        folds.append(fold)
        oos.append(pd.DataFrame({'game_id': te['game_id'].values, 'game_date': te['game_date'].values,
                                 'season': S, 'home': te['home'].values, 'away': te['away'].values,
                                 'home_win': y, 'p_model': p, 'early': e,
                                 'home_goals': te['home_goals'].values, 'away_goals': te['away_goals'].values,
                                 'decision': te['decision'].values, 'league_gpg': te['league_gpg'].values,
                                 'game_type': te['game_type'].values}))
    oos_df = pd.concat(oos, ignore_index=True) if oos else pd.DataFrame()
    return folds, oos_df


def pooled_early(oos: pd.DataFrame):
    e = oos[oos['early']]
    return metrics(e['home_win'].values, e['p_model'].values) if len(e) else {'n': 0}


def explain_coefficients(model, cols):
    """Raw-scale coefficients and the implied home-ice logit at equal teams."""
    sc, lr = model.named_steps['standardscaler'], model.named_steps['logisticregression']
    beta = lr.coef_[0] / sc.scale_
    home_logit = float(lr.intercept_[0] - np.sum(lr.coef_[0] * sc.mean_ / sc.scale_))
    return {c: float(b) for c, b in zip(cols, beta)}, home_logit


# ─── Main ─────────────────────────────────────────────────────────────────────

def model_version(training_date: datetime) -> str:
    return f"{MODEL_FAMILY}-v{MODEL_GENERATION}-{training_date.strftime('%Y%m%d')}"


def feature_params():
    keys = ['XG_HALFLIFE', 'OFFSEASON_KEEP', 'PTS_PRIOR_GAMES', 'ELO_K', 'ELO_KX', 'ELO_HFA',
            'ELO_OFFSEASON_REGRESSION', 'GOALIE_CUR_PRIOR_GP', 'GOALIE_SHRINK_GP', 'GOALIE_SEASON_DECAY',
            'XG_NORM_PRIOR_GOALS', 'REST_CAP']
    return {k: getattr(F, k) for k in keys}


def train(cols=None, save=True, legacy=True, verbose=True, M=None, xg_source=None):
    cols = list(cols or F.FEATURE_COLUMNS)
    if M is None:
        M, xg_source = build_matrix()
    folds, oos = walk_forward(M, cols)
    early = pooled_early(oos)

    legacy_folds = None
    if legacy:
        try:
            import contextlib
            import io
            import legacy_xgb
            cwd = os.getcwd()
            os.chdir(SCRIPT_DIR)
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    legacy_folds, legacy_oos = legacy_xgb.walk_forward()
            finally:
                os.chdir(cwd)
            if len(legacy_oos):
                oos = oos.merge(legacy_oos[['game_id', 'p_legacy']], on='game_id', how='left')
                for f in folds:
                    sub = oos[(oos['season'] == f['test_season']) & oos['p_legacy'].notna()]
                    f['legacy_xgb_same_games'] = {
                        'n': int(len(sub)),
                        'log_loss': float(log_loss(sub['home_win'], _clip(sub['p_legacy']), labels=[0, 1])),
                        'new_model_log_loss': float(log_loss(sub['home_win'], _clip(sub['p_model']), labels=[0, 1])),
                    }
                    lf = next((x for x in legacy_folds if x['test_season'] == f['test_season']), None)
                    if lf:
                        f['legacy_xgb'] = lf
                    e = sub[sub['early']]
                    if len(e):
                        f['legacy_xgb_same_games']['early_log_loss'] = float(
                            log_loss(e['home_win'], _clip(e['p_legacy']), labels=[0, 1]))
        except Exception as ex:  # legacy baseline is informative only
            print(f"[TRAIN] legacy XGB baseline failed: {ex}")

    # Final model: C tuned on the most recent season, fit on everything usable.
    usable = M[~M['burn_in']]
    C_final, C_scores = tune_C(usable, cols)
    final = fit_logit(usable, cols, C_final)
    betas, home_logit = explain_coefficients(final, cols)
    now = datetime.now(timezone.utc)

    if verbose:
        print(f"[TRAIN] xG source: {xg_source}; {len(M)} games; features {cols}")
        for f in folds:
            lg = f.get('legacy_xgb_same_games', {})
            print(f"  {f['test_season']}: LL {f['log_loss']:.4f} (home-rate {f['home_rate_baseline']['log_loss']:.4f}"
                  f"{', legacy XGB %.4f' % lg['log_loss'] if lg else ''}) Brier {f['brier']:.4f} acc {f['accuracy']:.3f} "
                  f"mean {f['mean_pred_home']:.3f} vs {f['actual_home']:.3f} slope {f['calibration_slope']:.2f} "
                  f"early LL {f['early'].get('log_loss', float('nan')):.4f} (n={f['early']['n']}) C={f['C']}")
        print(f"  early pooled: LL {early.get('log_loss', float('nan')):.4f} n={early['n']}")
        print(f"  final C={C_final}; home-ice logit {home_logit:.3f} (p={1 / (1 + np.exp(-home_logit)):.3f}); betas {betas}")

    meta = {
        'model_version': model_version(now),
        'model_type': 'logistic_regression_l2',
        'training_date': now.isoformat(),
        'training_seasons': sorted(int(s) for s in usable['season'].unique()),
        'n_train': int(len(usable)),
        'feature_columns': cols,
        'feature_params': feature_params(),
        'xg_source': xg_source,
        'game_types': list(F.NHL_GAME_TYPES),
        'C': C_final,
        'C_scores_latest_season': {str(k): v for k, v in C_scores.items()},
        'coefficients_raw': betas,
        'home_ice_logit': home_logit,
        'home_ice_prob_equal_teams': float(1 / (1 + np.exp(-home_logit))),
        'cv_results': folds,
        'early_season_pooled': early,
        'avg_log_loss': float(np.mean([f['log_loss'] for f in folds])) if folds else None,
        'avg_accuracy': float(np.mean([f['accuracy'] for f in folds])) if folds else None,
        'evaluation': ('season-level walk-forward: train on seasons < S, C tuned on S-1; '
                       'early = either team game number <= %d' % EARLY_GP),
    }
    if len(oos):
        os.makedirs(F.CACHE_DIR, exist_ok=True)
        oos.to_csv(OOS_PATH, index=False)
    if save:
        save_model(final, meta)
    return final, meta, oos


def save_model(model, meta, model_path=MODEL_PATH, meta_path=META_PATH):
    payload = {'kind': 'logit-v5', 'model': model, 'feature_columns': meta['feature_columns'],
               'model_version': meta['model_version']}
    with open(model_path, 'wb') as f:
        pickle.dump(payload, f)
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2, default=str)
    print(f"[SAVE] {model_path}\n[SAVE] {meta_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-save', action='store_true')
    ap.add_argument('--no-legacy', action='store_true')
    args = ap.parse_args()
    train(save=not args.no_save, legacy=not args.no_legacy)


if __name__ == '__main__':
    main()
