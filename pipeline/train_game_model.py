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

LINEUP_KEEP = ['game_id', 'd_lineup', 'd_lineup_level', 'd_lineup_asof', 'h_lineup_dq', 'a_lineup_dq', 'h_lineup_rated',
               'a_lineup_rated', 'lineup_ok', 'ratings_asof', 'ratings_data_max_season', 'history_max_date']


def attach_lineup_features(M: pd.DataFrame, lineup: pd.DataFrame | None = None, **kw) -> pd.DataFrame:
    """Merge the fast-track lineup features (lineup_adjust.build_lineup_matrix,
    point-in-time, L-actual) into the training matrix by game id.  Games
    without stored lineups (or without a baseline yet) get d_lineup = 0 and
    lineup_ok = False."""
    import lineup_adjust as L
    lm = L.build_lineup_matrix(**kw) if lineup is None else lineup
    M = M.drop(columns=[c for c in LINEUP_KEEP if c != 'game_id' and c in M.columns])
    if lm is None or lm.empty:
        M['d_lineup'] = 0.0
        M['lineup_ok'] = False
        return M
    M = M.merge(lm[[c for c in LINEUP_KEEP if c in lm.columns]], on='game_id', how='left')
    for c in ('d_lineup', 'd_lineup_level', 'd_lineup_asof'):
        if c in M.columns:
            M[c] = M[c].fillna(0.0)
    M['lineup_ok'] = M['lineup_ok'].astype('boolean').fillna(False).astype(bool)
    return M


BU_FEATURES_PATH = os.path.join(SCRIPT_DIR, 'bu', 'lineup', 'out', 'lineup_features.csv.gz')
BU_KEEP = ['game_id', 'bu_ok', *F.BU_COLUMNS]


def attach_bu_features(M: pd.DataFrame, path: str = BU_FEATURES_PATH) -> pd.DataFrame:
    """Merge the RAPM v2 lineup term (``python -m bu.lineup features``: point-in-time ratings
    as of 2 days before each game, L-actual dressed 18) by game id.  Games without a row, or
    under the coverage gate (``bu_ok`` False: < 14 rated skaters a side), get neutral 0, the
    same policy as the walk-forward (``bu.lineup.evaluate.attach``) and the live scorer."""
    M = M.drop(columns=[c for c in BU_KEEP if c != 'game_id' and c in M.columns])
    if not os.path.exists(path):
        for c in F.BU_COLUMNS:
            M[c] = 0.0
        M['bu_ok'] = False
        return M
    f = pd.read_csv(path, usecols=lambda c: c in BU_KEEP)
    ok = f['bu_ok'].astype(str).str.lower().isin(('true', '1'))
    for c in F.BU_COLUMNS:
        f[c] = pd.to_numeric(f[c], errors='coerce').where(ok, 0.0)
    f['bu_ok'] = ok
    M = M.merge(f.drop_duplicates('game_id'), on='game_id', how='left')
    for c in F.BU_COLUMNS:
        M[c] = M[c].fillna(0.0)
    M['bu_ok'] = M['bu_ok'].astype('boolean').fillna(False).astype(bool)
    return M


def build_matrix(current_df=None, use_raw_xg=True, lineups=True, xg='live', bu=True, dedupe='event'):
    games, xg_source = F.load_feature_games(current_df=current_df, use_raw_xg=use_raw_xg, xg=xg, dedupe=dedupe)
    M = F.build_training_matrix(games)
    if lineups and len(M):
        M = attach_lineup_features(M)
    if bu and len(M):
        M = attach_bu_features(M)
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

def model_version(training_date: datetime, cols=None, xg_version=None) -> str:
    """``logit-elo-v5-YYYYMMDD`` plus the input tags of models trained on xG v2 (``-xg2``) and
    with the RAPM v2 lineup term (``-rapm``), so two models trained the same day stay apart in
    the graded record (model_report groups by version within the ``logit-elo`` family)."""
    v = f"{MODEL_FAMILY}-v{MODEL_GENERATION}-{training_date.strftime('%Y%m%d')}"
    if xg_version == 'v2':
        v += '-xg2'
    if cols is not None and any(c in cols for c in F.BU_COLUMNS):
        v += '-rapm'
    return v


def feature_params():
    keys = ['XG_HALFLIFE', 'OFFSEASON_KEEP', 'PTS_PRIOR_GAMES', 'ELO_K', 'ELO_KX', 'ELO_HFA',
            'ELO_OFFSEASON_REGRESSION', 'GOALIE_CUR_PRIOR_GP', 'GOALIE_SHRINK_GP', 'GOALIE_SEASON_DECAY',
            'XG_NORM_PRIOR_GOALS', 'REST_CAP']
    return {k: getattr(F, k) for k in keys}


def train(cols=None, save=True, legacy=True, verbose=True, M=None, xg_source=None, prev_meta=None):
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
        'model_version': model_version(now, cols, F.history_xg_version()),
        'model_type': 'logistic_regression_l2',
        'training_date': now.isoformat(),
        'training_seasons': sorted(int(s) for s in usable['season'].unique()),
        'n_train': int(len(usable)),
        'feature_columns': cols,
        'feature_params': feature_params(),
        'xg_source': xg_source,
        # xG version of the training inputs; "v2" releases the bu.xg.live interlock (an unset
        # PONYXG_XG then scores live shots with v2, matching what this model learned from)
        'xg_version': F.history_xg_version(),
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
    ft = fasttrack_config(cols, prev_meta)
    if ft:
        meta['fasttrack'] = ft
    bu = bu_config(cols, prev_meta)
    if bu:
        meta['bu_lineup'] = bu
    if len(oos):
        os.makedirs(F.CACHE_DIR, exist_ok=True)
        oos.to_csv(OOS_PATH, index=False)
    if save:
        save_model(final, meta)
    return final, meta, oos


def fasttrack_config(cols, prev_meta=None):
    """meta['fasttrack'] for a model that uses the F1 lineup features: the
    lineup-state settings serving must replay (lineup_adjust module values, the
    ones build_matrix trained with), plus the previous model's gate record when
    it already used them.  None for a model without them."""
    if not any(c in cols for c in F.LINEUP_COLUMNS):
        return None
    import lineup_adjust as L
    prev = (prev_meta or {}).get('fasttrack') or {}
    return {**prev, 'lineup_cross_season': L.LINEUP_CROSS_SEASON, 'rating_value': L.RATING_VALUE}


def bu_config(cols, prev_meta=None):
    """meta['bu_lineup'] for a model that uses the RAPM v2 lineup term: the feature table it was
    trained on (sha256, as built by ``python -m bu.lineup features``), the serving bundle the
    live path reads and its freshness rule, plus the previous model's gate record."""
    if not any(c in cols for c in F.BU_COLUMNS):
        return None
    import hashlib
    from bu.lineup import serve as SV
    prev = (prev_meta or {}).get('bu_lineup') or {}
    fmeta_p = os.path.join(os.path.dirname(BU_FEATURES_PATH), 'lineup_features.meta.json')
    fmeta = {}
    try:
        with open(fmeta_p) as f:
            fmeta = json.load(f)
    except (OSError, ValueError):
        pass
    sha = None
    if os.path.exists(BU_FEATURES_PATH):
        with open(BU_FEATURES_PATH, 'rb') as f:
            sha = hashlib.sha256(f.read()).hexdigest()
    return {**prev, 'features': [c for c in cols if c in F.BU_COLUMNS],
            'training_table': os.path.relpath(BU_FEATURES_PATH, SCRIPT_DIR), 'training_table_sha256': sha,
            'rapm_xg_source': fmeta.get('xg_source'), 'rapm_code_version': fmeta.get('code_version'),
            'rapm_hyper': fmeta.get('hyper'),
            'serving_bundle': 'bu/lineup/out/serving_bundle.json.gz', 'max_age_h': SV.MAX_AGE_H,
            'min_rated': SV.MIN_RATED, 'flag': 'PONYXG_BU=on|off (off, stale bundle or coverage gate: the F1 rollback model shadow.f1 is published; the joint model is logged in bu_shadow_home_win_pct)'}


def save_model(model, meta, model_path=MODEL_PATH, meta_path=META_PATH):
    payload = {'kind': 'logit-v5', 'model': model, 'feature_columns': meta['feature_columns'],
               'model_version': meta['model_version']}
    with open(model_path, 'wb') as f:
        pickle.dump(payload, f)
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2, default=str)
    print(f"[SAVE] {model_path}\n[SAVE] {meta_path}")


def live_feature_columns(meta_path=META_PATH):
    """The promoted model's feature set (falls back to the incumbent columns).
    A plain retrain keeps it, so it never silently drops a gated feature such
    as the fast-track d_lineup."""
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        return list(meta.get('feature_columns') or F.FEATURE_COLUMNS), meta
    except (OSError, ValueError):
        return list(F.FEATURE_COLUMNS), {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-save', action='store_true')
    ap.add_argument('--no-legacy', action='store_true')
    ap.add_argument('--incumbent-features', action='store_true',
                    help='train on features.FEATURE_COLUMNS instead of the live model\'s feature set')
    args = ap.parse_args()
    cols, cur = live_feature_columns()
    if args.incumbent_features:
        cols = list(F.FEATURE_COLUMNS)
    print(f"[TRAIN] features: {cols}")
    train(cols=cols, save=not args.no_save, legacy=not args.no_legacy, prev_meta=cur)


if __name__ == '__main__':
    main()
