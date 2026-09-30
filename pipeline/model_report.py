#!/usr/bin/env python3
"""
model_report.py - public/data/model_report.json, the model's report card.

For each season (2025-26 and the current 2026-27) and game type (all /
regular / playoffs) it publishes, from LIVE pregame snapshots only (retro
rows are counted separately and never mixed into headline numbers):

  n, accuracy with a 95% Wilson interval, Brier, log loss;
  baselines: a home-rate constant (prior seasons' home win rate) and the
  de-vigged market (closing line from odds_closing.json when present, else
  the market price in the same pregame snapshot), each with its own numbers
  and the model's numbers on the same games;
  10-bin reliability data; accuracy by confidence tier (50-55/55-60/60-65/65+);
  rolling 100-game log loss vs the market; 5 best calls and 5 worst misses.

It also writes the bet gate status (market.site_gate) with a plain-English
reason, and a summary of the model's walk-forward validation.

An empty season (opening night) is a valid block with n = 0.
"""

from __future__ import annotations

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

import market  # noqa: E402

HISTORY_PATH = os.path.join(ROOT, 'data', 'prediction_history.json')
OUT_PATH = os.path.join(ROOT, 'public', 'data', 'model_report.json')
HISTORY_META_PATH = os.path.join(ROOT, 'data', 'prediction_history_meta.json')
META_PATH = os.path.join(SCRIPT_DIR, 'game_model_meta.json')
ODDS_CLOSING_PATH = os.path.join(ROOT, 'public', 'data', 'odds_closing.json')
SCHEMA_VERSION = 1
TIERS = [(0.50, 0.55, '50-55'), (0.55, 0.60, '55-60'), (0.60, 0.65, '60-65'), (0.65, 1.01, '65+')]
ROLLING_WINDOW = 100
CURRENT_MODEL_FAMILY = 'logit-elo'


def wilson(k, n, z=1.96):
    if n == 0:
        return None, None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def _ll(y, p):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, dtype=float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))) if len(y) else None


def _brier(y, p):
    return float(np.mean((np.asarray(p, float) - np.asarray(y, float)) ** 2)) if len(y) else None


def _acc(y, p):
    return float(np.mean((np.asarray(p) > 0.5) == (np.asarray(y) == 1))) if len(y) else None


def load_closing():
    """{gameId: home de-vigged prob} from odds_closing.json if B3 has written it."""
    try:
        with open(ODDS_CLOSING_PATH) as f:
            data = json.load(f)
    except Exception:
        return {}
    out = {}
    items = data.get('games', data) if isinstance(data, dict) else {}
    for gid, g in (items.items() if isinstance(items, dict) else []):
        if not isinstance(g, dict):
            continue
        h = next((g.get(k) for k in ('home_ml', 'home_price', 'home_odds', 'home') if g.get(k) is not None), None)
        a = next((g.get(k) for k in ('away_ml', 'away_price', 'away_odds', 'away') if g.get(k) is not None), None)
        q = market.devig([h, a]) if (h is not None and a is not None) else None
        if q and str(gid).isdigit():
            out[int(gid)] = q[0]
    return out


def home_rate_prior(season_start_year: int):
    """Home win rate of the seasons before ``season_start_year`` (the honest constant)."""
    import features as F
    g = F.load_gamestats(SCRIPT_DIR)
    h = g[(g['home_away'] == 'Home') & (g['season'] < season_start_year)]
    if h.empty:
        return 0.535, 'default'
    return float(h['result'].isin(F.WIN_RESULTS).mean()), f"{int(h['season'].min())}-{int(h['season'].max())} home win rate"


def call_row(r):
    p = r['homeWinProb'] / 100
    conf = max(p, 1 - p)
    return {'gameId': r['gameId'], 'date': r['date'], 'homeTeam': r['homeTeam'], 'awayTeam': r['awayTeam'],
            'pick': r['predictedWinner'], 'confidence': round(100 * conf, 1),
            'homeScore': r['homeScore'], 'awayScore': r['awayScore'], 'decision': r.get('decision'),
            'correct': bool(r['isCorrect'])}


def block(rows, home_rate, home_rate_source, closing):
    live = [r for r in rows if not r.get('retro')]
    n_retro = len(rows) - len(live)
    live = sorted(live, key=lambda r: (r['date'], r['gameId']))
    n = len(live)
    out = {'n': n, 'n_retro_excluded': n_retro}
    if n == 0:
        out.update({'accuracy': None, 'accuracy_ci': [None, None], 'brier': None, 'log_loss': None,
                    'baselines': {'home_rate': {'rate': home_rate, 'source': home_rate_source, 'n': 0,
                                                'log_loss': None, 'brier': None, 'accuracy': None},
                                  'market': {'n': 0, 'source': None, 'log_loss': None, 'brier': None,
                                             'accuracy': None, 'model_log_loss_same_games': None,
                                             'model_accuracy_same_games': None}},
                    'reliability': [], 'tiers': [], 'rolling': [], 'best_calls': [], 'worst_misses': [],
                    'first_date': None, 'last_date': None})
        return out
    y = np.array([1 if r['actualWinner'] == r['homeTeam'] else 0 for r in live])
    p = np.array([r['homeWinProb'] / 100 for r in live])
    k = int(sum(1 for r in live if r['isCorrect']))
    lo, hi = wilson(k, n)
    out.update({'accuracy': k / n, 'accuracy_ci': [lo, hi], 'correct': k,
                'brier': _brier(y, p), 'log_loss': _ll(y, p),
                'mean_pred_home': float(p.mean()), 'actual_home': float(y.mean()),
                'first_date': live[0]['date'], 'last_date': live[-1]['date']})
    # baselines
    hr = np.full(n, home_rate)
    q, src = [], []
    for r in live:
        if r['gameId'] in closing:
            q.append(closing[r['gameId']]); src.append('odds_closing')
        elif r.get('marketHomeProb') is not None:
            q.append(r['marketHomeProb'] / 100); src.append('snapshot')
        else:
            q.append(np.nan); src.append(None)
    q = np.array(q, dtype=float)
    m = ~np.isnan(q)
    srcs = sorted({s for s in src if s})
    out['baselines'] = {
        'home_rate': {'rate': home_rate, 'source': home_rate_source, 'n': n,
                      'log_loss': _ll(y, hr), 'brier': _brier(y, hr), 'accuracy': _acc(y, hr)},
        'market': {'n': int(m.sum()), 'source': '+'.join(srcs) if srcs else None,
                   'devig': 'power',
                   'log_loss': _ll(y[m], q[m]) if m.any() else None,
                   'brier': _brier(y[m], q[m]) if m.any() else None,
                   'accuracy': _acc(y[m], q[m]) if m.any() else None,
                   'model_log_loss_same_games': _ll(y[m], p[m]) if m.any() else None,
                   'model_accuracy_same_games': _acc(y[m], p[m]) if m.any() else None},
    }
    # reliability (10 equal-width bins of the home-win probability)
    edges = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(p, edges) - 1, 0, 9)
    out['reliability'] = [{'bin': b, 'lo': float(edges[b]), 'hi': float(edges[b + 1]), 'n': int((idx == b).sum()),
                           'mean_pred': float(p[idx == b].mean()) if (idx == b).any() else None,
                           'actual': float(y[idx == b].mean()) if (idx == b).any() else None}
                          for b in range(10)]
    # tiers by favourite confidence
    conf = np.maximum(p, 1 - p)
    correct = np.array([r['isCorrect'] for r in live])
    tiers = []
    for a, b, lab in TIERS:
        sel = (conf >= a) & (conf < b)
        c = int(correct[sel].sum()); t = int(sel.sum())
        tiers.append({'tier': lab, 'n': t, 'correct': c, 'accuracy': c / t if t else None,
                      'accuracy_ci': list(wilson(c, t)), 'mean_confidence': float(conf[sel].mean()) if t else None})
    out['tiers'] = tiers
    # rolling 100-game log loss vs market (games with a market price)
    roll = []
    ym, pm, qm = y[m], p[m], q[m]
    dates = [r['date'] for r, mm in zip(live, m) if mm]
    for i in range(ROLLING_WINDOW, len(ym) + 1):
        roll.append({'i': i, 'date': dates[i - 1],
                     'model': _ll(ym[i - ROLLING_WINDOW:i], pm[i - ROLLING_WINDOW:i]),
                     'market': _ll(ym[i - ROLLING_WINDOW:i], qm[i - ROLLING_WINDOW:i])})
    out['rolling'] = roll
    order = np.argsort(-conf)
    out['best_calls'] = [call_row(live[i]) for i in order if live[i]['isCorrect']][:5]
    out['worst_misses'] = [call_row(live[i]) for i in order if not live[i]['isCorrect']][:5]
    return out


def rolling_gate_stats(rows, closing, family=CURRENT_MODEL_FAMILY, window=market.ROLLING_N):
    """Last ``window`` live games with a market price, predicted by the CURRENT
    model family (older site models do not count as evidence for this one).
    The model side is the model-only probability (``modelHomeProb``) when the
    snapshot recorded it, else the published probability."""
    live = [r for r in rows if not r.get('retro') and str(r.get('modelVersion') or '').startswith(family)]
    live = sorted(live, key=lambda r: (r['date'], r['gameId']))
    pairs = []
    for r in live:
        qv = closing.get(r['gameId'], (r['marketHomeProb'] / 100) if r.get('marketHomeProb') is not None else None)
        pm = r.get('modelHomeProb')
        pv = (pm if pm is not None else r['homeWinProb']) / 100
        if qv is not None:
            pairs.append((1 if r['actualWinner'] == r['homeTeam'] else 0, pv, qv))
    pairs = pairs[-window:]
    if not pairs:
        return {'n': 0, 'window': window, 'model_family': family, 'model_log_loss': None, 'market_log_loss': None}
    y, p, q = map(np.array, zip(*pairs))
    return {'n': len(pairs), 'window': window, 'model_family': family,
            'model_log_loss': _ll(y, p), 'market_log_loss': _ll(y, q)}


def clarify_gate_reasons(reasons, rolling, n_graded_season, season_label):
    """market.site_gate counts only games predicted by the CURRENT model family; say so,
    so 'Only 0 live games' does not read as a contradiction next to N graded games."""
    n = (rolling or {}).get('n', 0) or 0
    out = []
    for r in reasons:
        if r.startswith('Only ') and 'live games with odds' in r:
            fam = (rolling or {}).get('model_family') or CURRENT_MODEL_FAMILY
            r = (f"Only {n} graded game{'s' if n != 1 else ''} with market odds were predicted by the current "
                 f"model ({fam}) so far ({n_graded_season} graded in {season_label} in all); "
                 f"need {market.ROLLING_N} to compare it with the market.")
        out.append(r)
    return out


def load_not_graded():
    """Finals generate_history.py left ungraded, with the reason (prediction_history_meta.json)."""
    try:
        with open(HISTORY_META_PATH) as f:
            items = json.load(f).get('not_graded') or []
    except Exception:
        return []
    keep = ('gameId', 'date', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore', 'decision', 'reason', 'label',
            'season', 'gameType')
    return [{k: g.get(k) for k in keep} for g in items if isinstance(g, dict)]


def season_of_row(r):
    return r.get('season') or (lambda y: f"{y}-{str(y + 1)[2:]}")(int(str(r['gameId'])[:4]))


def build_report(history=None, now=None):
    from season import SEASON_LABEL, START_YEAR
    if history is None:
        with open(HISTORY_PATH) as f:
            history = json.load(f)
    closing = load_closing()
    seasons = sorted({season_of_row(r) for r in history} | {SEASON_LABEL, f"{START_YEAR - 1}-{str(START_YEAR)[2:]}"})
    report = {'schema_version': SCHEMA_VERSION,
              'generated_at': (now or datetime.now(timezone.utc)).isoformat(),
              'current_season': SEASON_LABEL,
              'notes': ('Headline numbers use live pregame snapshots only. Retro (back-filled) rows are '
                        'counted in n_retro_excluded and never mixed in. Market = de-vigged (power method).'),
              'seasons': {}}
    not_graded = load_not_graded()
    for s in seasons:
        rows = [r for r in history if season_of_row(r) == s]
        start_year = int(s[:4])
        rate, src = home_rate_prior(start_year)
        report['seasons'][s] = {
            'all': block(rows, rate, src, closing),
            'regular': block([r for r in rows if r.get('gameType', '02') == '02'], rate, src, closing),
            'playoffs': block([r for r in rows if r.get('gameType') == '03'], rate, src, closing),
            # Completed games that are deliberately not graded (e.g. predicted after puck drop).
            'not_graded': [g for g in not_graded if g.get('season') == s],
        }
    # gate
    bt = None
    try:
        with open(market.BACKTEST_PATH) as f:
            btj = json.load(f)
        bt = btj.get('gate_evidence')
        bt_summary = {'n_games': btj['sample']['n_games'], 'log_loss': btj['log_loss'],
                      'blend_weight': btj['blend_weight']['live_value'],
                      'rule': btj['betting_replay']['rule']}
    except Exception:
        bt_summary = None
    rolling = rolling_gate_stats(history, closing)
    state = {'backtest': bt, 'rolling': rolling}
    ok, reasons = market.site_gate(state)
    n_cur = sum(1 for r in history if season_of_row(r) == SEASON_LABEL and not r.get('retro'))
    reasons = clarify_gate_reasons(reasons, rolling, n_cur, SEASON_LABEL)
    report['gate'] = {
        'open': ok,
        'status': 'open' if ok else 'closed',
        'summary': ('Bet sizes are shown because the betting rule has a proven edge.' if ok else
                    'Bet sizes are hidden: the model has not yet proven an edge over the betting market.'),
        'reasons': reasons,
        'reason': ' '.join(reasons) if reasons else 'All gate conditions pass.',
        'backtest': bt,
        'rolling': rolling,
        'rule': {'min_ev': market.MIN_EV, 'kelly_fraction': market.KELLY_FRACTION,
                 'min_team_gp': market.MIN_TEAM_GP, 'rolling_window': market.ROLLING_N,
                 'roi_ci_floor': market.ROI_CI_FLOOR},
    }
    report['market_backtest'] = bt_summary
    try:
        with open(META_PATH) as f:
            meta = json.load(f)
        report['model'] = {
            'name': 'Pony xG logistic + Elo',
            'description': ('Regularised logistic regression on pregame features (xG-share form, Elo, '
                            'goaltending, points%, rest), blended with the de-vigged betting market.'),
            'training_seasons': [f"{s}-{str(s + 1)[2:]}" for s in meta.get('training_seasons', [])],
            'version': meta.get('model_version'), 'type': meta.get('model_type'),
            'trained_at': meta.get('training_date'), 'features': meta.get('feature_columns'),
            'walk_forward': [{k: f.get(k) for k in ('test_season', 'n', 'log_loss', 'brier', 'accuracy',
                                                    'calibration_slope', 'mean_pred_home', 'actual_home')}
                             | {'home_rate_log_loss': f['home_rate_baseline']['log_loss'],
                                'legacy_xgb_log_loss': (f.get('legacy_xgb_same_games') or {}).get('log_loss')}
                             for f in meta.get('cv_results', [])],
            'early_season_log_loss': (meta.get('early_season_pooled') or {}).get('log_loss'),
        }
    except Exception:
        report['model'] = None
    return report


def round_floats(x, nd=4):
    if isinstance(x, float):
        return None if math.isnan(x) else round(x, nd)
    if isinstance(x, dict):
        return {k: round_floats(v, nd) for k, v in x.items()}
    if isinstance(x, list):
        return [round_floats(v, nd) for v in x]
    if isinstance(x, (np.floating,)):
        return round(float(x), nd)
    if isinstance(x, (np.integer,)):
        return int(x)
    return x


def _graded_changed_at():
    try:
        with open(HISTORY_META_PATH) as f:
            return json.load(f).get('graded_changed_at')
    except Exception:
        return None


def write_if_changed(path, obj, **dump_kw):
    """Write ``obj`` unless only its generated_at differs from the file on disk
    (an hourly run with nothing new must not produce a data commit).  The file is
    still rewritten when its generated_at predates the last change to the graded
    record, so validate_outputs 'reports' always sees it as current."""
    try:
        with open(path) as f:
            old = json.load(f)
    except Exception:
        old = None
    if isinstance(old, dict):
        same = {k: v for k, v in old.items() if k != 'generated_at'} == \
            json.loads(json.dumps({k: v for k, v in obj.items() if k != 'generated_at'}, default=float))
        changed_at = _graded_changed_at()
        fresh = True
        if changed_at:
            try:
                fresh = pd.Timestamp(old.get('generated_at')) >= pd.Timestamp(changed_at)
            except (TypeError, ValueError):
                fresh = False
        if same and fresh:
            obj['generated_at'] = old.get('generated_at')
            return False
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, **dump_kw)
    os.replace(tmp, path)
    return True


def write_report(path=OUT_PATH, **kw):
    rep = round_floats(build_report(**kw))
    if not write_if_changed(path, rep, indent=1, default=float):
        print("[model_report] unchanged except generated_at - not rewritten")
    s = rep['seasons']
    for k, v in s.items():
        a = v['all']
        print(f"[model_report] {k}: n={a['n']} (retro excluded {a['n_retro_excluded']}) "
              f"LL={a['log_loss']} market={a['baselines']['market']['log_loss']}")
    print(f"[model_report] gate {'OPEN' if rep['gate']['open'] else 'CLOSED'}: {rep['gate']['reasons']}")
    return rep


if __name__ == '__main__':
    write_report()
