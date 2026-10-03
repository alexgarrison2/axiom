#!/usr/bin/env python3
"""
market.py - market-anchored probabilities, EV and the proven-edge gate.

The de-vigged betting market beat the site model on every live sample
(log loss 0.6742 vs 0.6823 on 410 games), and the old 'EV' picks lost money.
So the number we publish is a blend anchored to the market:

    q      = devig(home_price, away_price, method='power')
    p_live = sigmoid(w * logit(p_model) + (1 - w) * logit(q))

The owner sets w = OWNER_MODEL_WEIGHT (0.80: mostly model, every game, all
season; decided 2026-10-03).  The repository variable PONYXG_MODEL_WEIGHT
overrides it: a number in [0, 1], or 'fitted' for the evidence-based weight,
which is fitted walk-forward on live snapshots (``run_backtest``), stored in
scoring_coefficients.json as ``market_blend_weight`` and ramped up from
DEFAULT_BLEND_WEIGHT over the first EARLY_WEIGHT_GP games.  Without odds the
model probability is used as is.

EV is always a FRACTION (0.051 == 5.1%), computed from the blended
probability and the actual price.  ``gate`` decides whether a bet is shown:
units are emitted only when

  1. the backtest of this very rule shows a flat-bet ROI whose 95% bootstrap
     CI lower bound is > -2% AND a positive mean CLV (else closed site-wide),
  2. the model's rolling 200-game log loss is <= the market's on live games,
  3. the blended EV >= MIN_EV (3%),
  4. both teams have >= 10 GP, unless the preseason-prior flag is turned off.

Sizing is quarter Kelly (KELLY_FRACTION = 0.25), 1 unit = 1% of bankroll,
capped at MAX_UNITS - exactly what the docs say.

CLI:
    python3 market.py --backtest    # writes tests/out/market_backtest.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

COEFF_PATH = os.path.join(SCRIPT_DIR, 'scoring_coefficients.json')
REPORT_PATH = os.path.join(ROOT, 'public', 'data', 'model_report.json')
BACKTEST_PATH = os.path.join(SCRIPT_DIR, 'tests', 'out', 'market_backtest.json')

MIN_EV = 0.03
KELLY_FRACTION = 0.25
MAX_UNITS = 5.0
MIN_TEAM_GP = 10
ROLLING_N = 200
ROI_CI_FLOOR = -0.02
DEFAULT_BLEND_WEIGHT = 0.2
BLEND_PRIOR_GAMES = 200
EARLY_WEIGHT_GP = 20     # model weight ramps linearly from the prior to the fitted value over 20 GP
OWNER_MODEL_WEIGHT = 0.80   # owner's choice: the published % is 80% model, 20% market
WEIGHT_ENV = "PONYXG_MODEL_WEIGHT"   # rollback / override: a number, or 'fitted'


# ─── Pricing ──────────────────────────────────────────────────────────────────

def to_decimal(price):
    """American (e.g. -110, +150) or decimal (>1, <=~50) odds to decimal."""
    if price is None:
        return None
    try:
        p = float(price)
    except (TypeError, ValueError):
        return None
    if math.isnan(p):
        return None
    if abs(p) >= 100:
        return p / 100 + 1 if p > 0 else 100 / abs(p) + 1
    if 1.0 < p < 100:
        return p
    return None


def implied(price):
    d = to_decimal(price)
    return 1 / d if d else None


def devig(prices, method='power'):
    """Fair probabilities from a two-way (or n-way) market.

    'power' solves sum(r_i ** k) = 1 for k (handles favourite-longshot bias
    better than proportional); 'proportional' divides by the overround."""
    r = [implied(p) for p in prices]
    if any(x is None for x in r):
        return None
    r = np.array(r, dtype=float)
    if method == 'proportional':
        return list(r / r.sum())
    if abs(r.sum() - 1) < 1e-12:
        return list(r)
    lo, hi = 0.1, 10.0
    for _ in range(100):
        k = (lo + hi) / 2
        s = np.sum(r ** k)
        if s > 1:
            lo = k
        else:
            hi = k
    k = (lo + hi) / 2
    q = r ** k
    return list(q / q.sum())


def overround(prices):
    r = [implied(p) for p in prices]
    return None if any(x is None for x in r) else float(sum(r) - 1)


def _logit(p):
    p = min(max(float(p), 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def _sigmoid(z):
    return 1 / (1 + math.exp(-z))


def owner_weight():
    """The published model weight unless PONYXG_MODEL_WEIGHT=fitted (then None)."""
    v = (os.environ.get(WEIGHT_ENV) or "").strip().lower()
    if v == "fitted":
        return None
    if v:
        try:
            return min(1.0, max(0.0, float(v)))
        except ValueError:
            print(f"[market] ignoring {WEIGHT_ENV}={v!r}; using {OWNER_MODEL_WEIGHT}")
    return OWNER_MODEL_WEIGHT


def effective_weight(w=None, home_gp=None, away_gp=None):
    """Model weight for a game: the owner's weight (owner_weight) unless
    PONYXG_MODEL_WEIGHT=fitted.  The fitted weight comes from in-season games;
    early in a season the model runs on regressed priors while the market
    already prices roster changes, so the weight starts at the prior
    (DEFAULT_BLEND_WEIGHT) and ramps linearly to the fitted value: at min GP g,
    w = w0 + (w_fit - w0) * min(1, g / EARLY_WEIGHT_GP).  The fit sample (March
    onward) is entirely past that ramp.  Without GP info the fitted value is used."""
    o = owner_weight()
    if o is not None:
        return o
    w = blend_weight() if w is None else w
    if home_gp is None or away_gp is None:
        return w
    g = max(0.0, float(min(home_gp, away_gp)))
    w0 = min(DEFAULT_BLEND_WEIGHT, w)
    return w0 + (w - w0) * min(1.0, g / EARLY_WEIGHT_GP)


def blend(p_model, q_market, w=None):
    """Logit-space blend; model-only when the market is missing."""
    if q_market is None or (isinstance(q_market, float) and math.isnan(q_market)):
        return float(p_model)
    w = blend_weight() if w is None else w
    return _sigmoid(w * _logit(p_model) + (1 - w) * _logit(q_market))


def ev_from(p, price):
    """Expected profit per 1 unit staked, as a FRACTION (0.05 == +5%)."""
    d = to_decimal(price)
    if d is None or p is None:
        return None
    return float(p) * d - 1


def passes_ev(ev, threshold=MIN_EV):
    return ev is not None and ev >= threshold


def kelly_units(p, price, fraction=KELLY_FRACTION, max_units=MAX_UNITS):
    """Quarter-Kelly stake in units (1u = 1% of bankroll), rounded to 0.1."""
    d = to_decimal(price)
    if d is None:
        return 0.0
    b = d - 1
    f = (b * p - (1 - p)) / b
    if f <= 0:
        return 0.0
    return round(min(max_units, 100 * fraction * f), 1)


# ─── Parameters / state ───────────────────────────────────────────────────────

def _read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def blend_weight():
    c = _read_json(COEFF_PATH) or {}
    v = c.get('market_blend_weight')
    if isinstance(v, dict):
        v = v.get('value')
    return float(v) if v is not None else DEFAULT_BLEND_WEIGHT


def load_gate_state(report_path=REPORT_PATH, backtest_path=BACKTEST_PATH):
    """Inputs of the site-wide gate: backtest evidence + rolling live log loss."""
    rep = _read_json(report_path) or {}
    bt = _read_json(backtest_path) or {}
    g = rep.get('gate') or {}
    return {
        'backtest': g.get('backtest') or bt.get('gate_evidence'),
        'rolling': g.get('rolling'),
    }


def site_gate(state=None):
    """(open, reasons) for the whole site, independent of a specific game."""
    state = load_gate_state() if state is None else state
    reasons = []
    bt = state.get('backtest') or {}
    if not bt:
        reasons.append('No backtest evidence for the betting rule yet.')
    else:
        lo = bt.get('roi_ci_low')
        clv = bt.get('clv_mean')
        if lo is None or lo <= ROI_CI_FLOOR:
            reasons.append(f"Backtest ROI 95% CI lower bound {lo:+.1%} is not above {ROI_CI_FLOOR:+.0%}."
                           if lo is not None else 'Backtest ROI CI unavailable.')
        if clv is None or clv <= 0:
            reasons.append(f"Backtest closing-line value {clv:+.2%} is not positive."
                           if clv is not None else 'Backtest CLV unavailable.')
    roll = state.get('rolling') or {}
    n = roll.get('n', 0) or 0
    if n < ROLLING_N:
        reasons.append(f"Only {n} live games with odds this season; need {ROLLING_N} to compare with the market.")
    elif roll.get('model_log_loss') is None or roll.get('market_log_loss') is None \
            or roll['model_log_loss'] > roll['market_log_loss']:
        reasons.append(f"Rolling {ROLLING_N}-game model log loss {roll.get('model_log_loss')} is worse than the "
                       f"market's {roll.get('market_log_loss')}.")
    return (len(reasons) == 0), reasons


def gate(ev, home_gp=None, away_gp=None, state=None, preseason_prior=True, min_ev=MIN_EV):
    """True only when a bet on this side may be shown (see module docstring)."""
    ok, reasons = site_gate(state)
    if not ok:
        return False, reasons
    if not passes_ev(ev, min_ev):
        return False, [f"Blended EV {ev if ev is not None else float('nan'):+.1%} is below {min_ev:.0%}."]
    if preseason_prior and (home_gp is None or away_gp is None or min(home_gp, away_gp) < MIN_TEAM_GP):
        return False, [f"Early season: both teams need {MIN_TEAM_GP}+ games."]
    return True, []


def price_game(p_model, home_price=None, away_price=None, home_gp=None, away_gp=None,
               state=None, w=None, market_source=None, fetched_at=None):
    """Everything predict_games needs for one game (A10 contract).

    Returns home/away model, market (de-vigged) and blended probabilities,
    EV fractions from the blended probability, gate decision, units and pick.
    """
    q = devig([home_price, away_price]) if (home_price is not None and away_price is not None) else None
    q_home = q[0] if q else None
    w = effective_weight(w, home_gp, away_gp)
    p_home = blend(p_model, q_home, w) if q_home is not None else float(p_model)
    ev_h = ev_from(p_home, home_price)
    ev_a = ev_from(1 - p_home, away_price)
    state = load_gate_state() if state is None else state
    best = None
    for side, ev, p, price in (('home', ev_h, p_home, home_price), ('away', ev_a, 1 - p_home, away_price)):
        if ev is not None and (best is None or ev > best[1]):
            best = (side, ev, p, price)
    open_, reasons = (False, ['No odds for this game.']) if best is None else \
        gate(best[1], home_gp, away_gp, state)
    units = kelly_units(best[2], best[3]) if (open_ and best) else None
    if units is not None and units < 0.1:
        units, open_ = None, False
    return {
        'model_prob_home': float(p_model),
        'market_prob_home': q_home,
        'blended_prob_home': p_home,
        'blend_weight': w if q_home is not None else 1.0,
        'overround': overround([home_price, away_price]) if q else None,
        'ev_home': ev_h,
        'ev_away': ev_a,
        'ev_gated': bool(open_),
        'bet_side': best[0] if (open_ and best) else None,
        'units': units,
        'gate_reasons': reasons,
        'market_source': market_source,
        'market_fetched_at': fetched_at,
    }


# ─── Backtest ─────────────────────────────────────────────────────────────────

def _ll(y, p):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, dtype=float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def fit_blend_weight(p_model, q, y, grid=np.linspace(0, 1, 101)):
    zm = np.log(np.clip(p_model, 1e-6, 1 - 1e-6) / (1 - np.clip(p_model, 1e-6, 1 - 1e-6)))
    zq = np.log(np.clip(q, 1e-6, 1 - 1e-6) / (1 - np.clip(q, 1e-6, 1 - 1e-6)))
    best = min(grid, key=lambda w: _ll(y, 1 / (1 + np.exp(-(w * zm + (1 - w) * zq)))))
    return float(best)


def walk_forward_weights(p_model, q, y, w0=DEFAULT_BLEND_WEIGHT, prior_games=BLEND_PRIOR_GAMES, min_games=30):
    """Weight used for game i, fitted only on games before i, shrunk toward w0."""
    ws = []
    for i in range(len(y)):
        if i < min_games:
            ws.append(w0)
            continue
        w_hat = fit_blend_weight(p_model[:i], q[:i], y[:i], grid=np.linspace(0, 1, 51))
        ws.append((i * w_hat + prior_games * w0) / (i + prior_games))
    return np.array(ws)


def bootstrap_ci(x, n=5000, seed=7):
    x = np.asarray(x, dtype=float)
    if len(x) == 0:
        return None, None
    rng = np.random.default_rng(seed)
    means = rng.choice(x, size=(n, len(x)), replace=True).mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def as_of_model_predictions(games, cutoff, goalie_overrides=None):
    """Fit the live model spec on games before ``cutoff`` and predict every game
    on/after it with pregame features (mimics the weekly retrain).  Test games
    use the starters the site projected before puck drop, not the actual ones."""
    import features as F
    import train_game_model as T
    M = F.build_training_matrix(games)
    if goalie_overrides:
        Mo = F.build_training_matrix(games, goalie_overrides=goalie_overrides)
        M = pd.concat([M[M['game_date'] < pd.Timestamp(cutoff)], Mo[Mo['game_date'] >= pd.Timestamp(cutoff)]])
    first = M['season'].min()
    M['burn_in'] = (M['season'] == first) & ((M['h_gp'] < T.BURN_IN_GP) | (M['a_gp'] < T.BURN_IN_GP))
    cols = F.FEATURE_COLUMNS
    tr = M[(M['game_date'] < pd.Timestamp(cutoff)) & ~M['burn_in']]
    C, _ = T.tune_C(tr, cols)
    model = T.fit_logit(tr, cols, C)
    te = M[M['game_date'] >= pd.Timestamp(cutoff)].copy()
    te['p_new'] = model.predict_proba(te[cols].values)[:, 1]
    return te[['game_id', 'p_new', 'h_rs_gp', 'a_rs_gp']], C


def run_backtest(out_path=BACKTEST_PATH, allow_fetch=True, verbose=True):
    import features as F
    import site_history as S

    sh, sched = S.load_keyed_site_history(allow_fetch=allow_fetch)
    games, _ = F.load_feature_games()
    res = games[games['home_away'] == 'Home'][['game_id', 'result', 'game_date']].copy()
    res['home_win'] = res['result'].isin(F.WIN_RESULTS).astype(int)

    last = S.last_pregame(sh)
    first = S.first_pregame(sh)
    last = last.merge(res[['game_id', 'home_win']], on='game_id', how='inner')
    last = last.dropna(subset=['home_odds', 'away_odds', 'p_home'])
    last = last[(last['home_odds'].abs() >= 100) & (last['away_odds'].abs() >= 100)]
    last = last.sort_values('start_ts').reset_index(drop=True)
    cutoff = (last['start_ts'].min() - pd.Timedelta(days=1)).tz_convert(None).normalize()
    overrides = {}
    for r in last.itertuples(index=False):
        d = r.start_ts.tz_convert('US/Eastern').tz_localize(None).normalize()
        overrides[int(r.game_id)] = (F.project_goalie(games, r.home, r.home_starter, d),
                                     F.project_goalie(games, r.away, r.away_starter, d))
    preds, C = as_of_model_predictions(games, cutoff, overrides)
    last = last.merge(preds, on='game_id', how='left')
    n_missing = int(last['p_new'].isna().sum())
    last = last.dropna(subset=['p_new']).reset_index(drop=True)

    q = np.array([devig([h, a])[0] for h, a in zip(last['home_odds'], last['away_odds'])])
    q_prop = np.array([devig([h, a], 'proportional')[0] for h, a in zip(last['home_odds'], last['away_odds'])])
    y = last['home_win'].values
    p_site = last['p_home'].values
    p_new = last['p_new'].values
    ws = walk_forward_weights(p_new, q, y)
    zb = ws * np.log(p_new / (1 - p_new)) + (1 - ws) * np.log(q / (1 - q))
    p_blend = 1 / (1 + np.exp(-zb))
    w_final = fit_blend_weight(p_new, q, y)
    w_live = (len(y) * w_final + BLEND_PRIOR_GAMES * DEFAULT_BLEND_WEIGHT) / (len(y) + BLEND_PRIOR_GAMES)
    sweep = {f'{w:.1f}': _ll(y, 1 / (1 + np.exp(-(w * np.log(p_new / (1 - p_new)) + (1 - w) * np.log(q / (1 - q))))))
             for w in np.linspace(0, 1, 11)}
    site_sweep = {f'{w:.1f}': _ll(y, 1 / (1 + np.exp(-(w * np.log(p_site / (1 - p_site)) + (1 - w) * np.log(q / (1 - q))))))
                  for w in np.linspace(0, 1, 11)}

    # ---- betting replay: bet at the FIRST pregame price, grade vs result, CLV vs LAST pregame price
    fp = first.set_index('game_id')[['home_odds', 'away_odds', 'snapshot_utc']]
    bets = []
    for i, r in last.iterrows():
        gid = r['game_id']
        if gid not in fp.index or pd.isna(fp.loc[gid, 'home_odds']) or pd.isna(fp.loc[gid, 'away_odds']):
            continue
        oh, oa = fp.loc[gid, 'home_odds'], fp.loc[gid, 'away_odds']
        if abs(oh) < 100 or abs(oa) < 100:
            continue
        q_open = devig([oh, oa])[0]
        pb = blend(p_new[i], q_open, ws[i])
        for side, p, price, close_q, won in (
                ('home', pb, oh, q[i], y[i] == 1), ('away', 1 - pb, oa, 1 - q[i], y[i] == 0)):
            ev = ev_from(p, price)
            ev_site = ev_from(p_site[i] if side == 'home' else 1 - p_site[i], price)
            d = to_decimal(price)
            bets.append({'game_id': int(gid), 'side': side, 'price': float(price), 'ev_blend': ev,
                         'ev_site_model': ev_site, 'won': bool(won),
                         'profit': (d - 1) if won else -1.0,
                         'clv': close_q * d - 1})
    B = pd.DataFrame(bets)

    def summarize(sel, label):
        x = B[sel]
        if x.empty:
            return {'label': label, 'n': 0}
        lo, hi = bootstrap_ci(x['profit'].values)
        return {'label': label, 'n': int(len(x)), 'win_rate': float(x['won'].mean()),
                'units': float(x['profit'].sum()), 'roi': float(x['profit'].mean()),
                'roi_ci_low': lo, 'roi_ci_high': hi,
                'clv_mean': float(x['clv'].mean()), 'clv_positive_share': float((x['clv'] > 0).mean())}

    rule = summarize(B['ev_blend'] >= MIN_EV, f'blended EV >= {MIN_EV:.0%} (the live rule)')
    evidence = {k: rule.get(k) for k in ('n', 'roi', 'roi_ci_low', 'roi_ci_high', 'clv_mean')}
    ok, reasons = site_gate({'backtest': evidence, 'rolling': {'n': len(y), 'model_log_loss': _ll(y, p_new),
                                                               'market_log_loss': _ll(y, q)}})
    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'sample': {
            'source': 'public/data/SiteHistory, last snapshot before puck drop per NHL gameId',
            'n_games': int(len(y)), 'first_game': str(last['start_ts'].min()), 'last_game': str(last['start_ts'].max()),
            'n_dropped_no_model_prediction': n_missing,
            'mean_overround': float(np.mean([overround([h, a]) for h, a in zip(last['home_odds'], last['away_odds'])])),
            'model_trained_through': str((cutoff - pd.Timedelta(days=1)).date()), 'model_C': C,
            'goalies': 'projected starters from the snapshot (last-name match), else the most frequent recent starter',
        },
        'log_loss': {
            'market_power_devig': _ll(y, q), 'market_proportional_devig': _ll(y, q_prop),
            'site_model_as_shown': _ll(y, p_site), 'new_model': _ll(y, p_new),
            'blend_walk_forward': _ll(y, p_blend), 'coin_flip': math.log(2),
        },
        'brier': {'market': float(np.mean((q - y) ** 2)), 'new_model': float(np.mean((p_new - y) ** 2)),
                  'blend_walk_forward': float(np.mean((p_blend - y) ** 2)), 'site_model': float(np.mean((p_site - y) ** 2))},
        'accuracy': {'market_favourite': float(np.mean((q > 0.5) == (y == 1))),
                     'new_model': float(np.mean((p_new > 0.5) == (y == 1))),
                     'blend': float(np.mean((p_blend > 0.5) == (y == 1))),
                     'site_model': float(np.mean((p_site > 0.5) == (y == 1)))},
        'blend_weight': {
            'walk_forward_prior': DEFAULT_BLEND_WEIGHT, 'prior_games': BLEND_PRIOR_GAMES,
            'walk_forward_mean': float(ws.mean()), 'walk_forward_last': float(ws[-1]),
            'in_sample_best': w_final, 'live_value': float(w_live),
            'fixed_weight_sweep_new_model': sweep, 'fixed_weight_sweep_site_model': site_sweep,
        },
        'betting_replay': {
            'method': ('bet at the first pregame snapshot price with the blended probability; '
                       'result from the official final; CLV = closing (last pregame) de-vigged '
                       'probability x bet decimal price - 1; flat 1 unit per bet; ROI CI = 5000 bootstrap'),
            'rule': rule,
            'all_positive_blend_ev': summarize(B['ev_blend'] > 0, 'blended EV > 0'),
            'old_site_rule': summarize(B['ev_site_model'] > 0, 'site model EV > 0 (what the site did)'),
            'old_site_rule_5pct': summarize(B['ev_site_model'] > 0.05, 'site model EV > 5%'),
        },
        'gate_evidence': evidence,
        'gate': {'open': ok, 'reasons': reasons},
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(report, f, indent=2, default=float)
    if verbose:
        print(json.dumps({k: report[k] for k in ('sample', 'log_loss', 'blend_weight')}, indent=1, default=float))
        print(json.dumps(report['betting_replay'], indent=1, default=float))
        print('gate:', ok, reasons)
    return report


def save_blend_weight(report):
    c = _read_json(COEFF_PATH) or {}
    bw = report['blend_weight']
    c['market_blend_weight'] = {
        'value': round(bw['live_value'], 3),
        'fit': 'market.py --backtest: in-sample best on live SiteHistory games shrunk toward the prior '
               f"{bw['walk_forward_prior']} with {bw['prior_games']} pseudo-games",
        'in_sample_best': bw['in_sample_best'],
        'n_games': report['sample']['n_games'],
        'fitted_at': report['generated_at'],
    }
    with open(COEFF_PATH, 'w') as f:
        json.dump(c, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--backtest', action='store_true')
    ap.add_argument('--no-fetch', action='store_true')
    ap.add_argument('--save-weight', action='store_true', help='write the fitted blend weight')
    args = ap.parse_args()
    if args.backtest:
        rep = run_backtest(allow_fetch=not args.no_fetch)
        if args.save_weight:
            save_blend_weight(rep)


if __name__ == '__main__':
    main()
