#!/usr/bin/env python3
"""
grade_bets.py - public/data/bet_ledger.json, the graded record of every bet
the site recommended.

* The bet is what the LAST pregame SiteHistory snapshot of each NHL gameId
  showed (side, stake in units - 1u = $5 in the snapshot - and price).
* Results join on the NHL gameId (not on '4/1/26' vs '2026-04-01' date
  strings, which matched only 23 of 265 bets before).
* Closing price and CLV come from odds_closing.json (last pregame line per
  gameId, written by fetch_odds - B3) when present; CLV = de-vigged closing
  probability of the bet side x bet decimal price - 1.
* Per season: record, units staked, profit, ROI with a 95% bootstrap CI,
  mean CLV, and the record by EV bucket and by stake size.
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

import generate_history as GH  # noqa: E402
import market  # noqa: E402
import site_history as S  # noqa: E402

OUT_PATH = os.path.join(ROOT, 'public', 'data', 'bet_ledger.json')
ODDS_CLOSING_PATH = os.path.join(ROOT, 'public', 'data', 'odds_closing.json')
SCHEMA_VERSION = 1
EV_BUCKETS = [(-1e9, 0.0, '<0%'), (0.0, 0.05, '0-5%'), (0.05, 0.10, '5-10%'),
              (0.10, 0.20, '10-20%'), (0.20, 1e9, '20%+')]
STAKE_BUCKETS = [(0, 0.55, '<=0.5u'), (0.55, 1.05, '0.6-1u'), (1.05, 2.05, '1.1-2u'), (2.05, 1e9, '2u+')]


def load_closing_prices():
    try:
        with open(ODDS_CLOSING_PATH) as f:
            data = json.load(f)
    except Exception:
        return {}
    items = data.get('games', data) if isinstance(data, dict) else {}
    out = {}
    for gid, g in (items.items() if isinstance(items, dict) else []):
        if not isinstance(g, dict) or not str(gid).isdigit():
            continue
        h = next((g.get(k) for k in ('home_ml', 'home_price', 'home_odds', 'home') if g.get(k) is not None), None)
        a = next((g.get(k) for k in ('away_ml', 'away_price', 'away_odds', 'away') if g.get(k) is not None), None)
        if h is not None and a is not None:
            out[int(gid)] = (float(h), float(a))
    return out


def bootstrap_roi(profit, stake, n=5000, seed=11):
    profit = np.asarray(profit, float); stake = np.asarray(stake, float)
    if len(profit) == 0:
        return None, None
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(profit), size=(n, len(profit)))
    roi = profit[idx].sum(axis=1) / stake[idx].sum(axis=1)
    return float(np.percentile(roi, 2.5)), float(np.percentile(roi, 97.5))


def _bucket(v, buckets):
    for lo, hi, lab in buckets:
        if lo <= v < hi:
            return lab
    return buckets[-1][2]


def summarize(bets):
    graded = [b for b in bets if b['result'] in ('win', 'loss')]
    out = {'n_bets': len(bets), 'n_graded': len(graded), 'n_pending': sum(1 for b in bets if b['result'] == 'pending')}
    if not graded:
        out.update({'record': '0-0', 'wins': 0, 'losses': 0, 'units_staked': 0.0, 'units_profit': 0.0,
                    'roi': None, 'roi_ci': [None, None], 'clv_mean': None, 'clv_n': 0,
                    'by_ev_bucket': [], 'by_stake': []})
        return out
    w = sum(1 for b in graded if b['result'] == 'win')
    st = sum(b['stake_units'] for b in graded)
    pr = sum(b['profit_units'] for b in graded)
    lo, hi = bootstrap_roi([b['profit_units'] for b in graded], [b['stake_units'] for b in graded])
    clv = [b['clv'] for b in graded if b['clv'] is not None]
    out.update({'record': f"{w}-{len(graded) - w}", 'wins': w, 'losses': len(graded) - w,
                'units_staked': st, 'units_profit': pr, 'roi': pr / st if st else None, 'roi_ci': [lo, hi],
                'clv_mean': float(np.mean(clv)) if clv else None, 'clv_n': len(clv)})

    def group(key, buckets):
        res = []
        for _, _, lab in buckets:
            g = [b for b in graded if b[key] == lab]
            if not g:
                res.append({'bucket': lab, 'n': 0, 'record': '0-0', 'units_profit': 0.0, 'roi': None})
                continue
            gw = sum(1 for b in g if b['result'] == 'win')
            gs = sum(b['stake_units'] for b in g); gp = sum(b['profit_units'] for b in g)
            res.append({'bucket': lab, 'n': len(g), 'record': f"{gw}-{len(g) - gw}",
                        'units_staked': gs, 'units_profit': gp, 'roi': gp / gs if gs else None})
        return res
    out['by_ev_bucket'] = group('ev_bucket', EV_BUCKETS)
    out['by_stake'] = group('stake_bucket', STAKE_BUCKETS)
    return out


def build_ledger(allow_fetch=True, now=None):
    sh, _ = S.load_keyed_site_history(allow_fetch=allow_fetch)
    snaps = S.last_pregame(sh) if len(sh) else pd.DataFrame()
    results = GH.load_results()
    res = {int(r.game_id): r for r in results.itertuples(index=False)}
    closing = load_closing_prices()
    excluded = GH.excluded_by_pipeline()
    now = now or datetime.now(timezone.utc)
    bets = []
    for snap in (snaps.to_dict('records') if len(snaps) else []):
        gid = int(snap['game_id'])
        if gid in excluded or str(gid)[4:6] not in ('02', '03'):
            continue
        for side in ('home', 'away'):
            units = snap.get(f'{side}_bet_units')
            if units is None or pd.isna(units) or units <= 0:
                continue
            price = snap.get(f'{side}_odds')
            if price is None or pd.isna(price):
                continue
            dec = market.to_decimal(price)
            r = res.get(gid)
            team = snap['home'] if side == 'home' else snap['away']
            opp = snap['away'] if side == 'home' else snap['home']
            if r is None:
                result, profit, score, decision = 'pending', 0.0, None, None
            else:
                won = bool(r.home_won) if side == 'home' else not bool(r.home_won)
                result = 'win' if won else 'loss'
                profit = units * (dec - 1) if won else -units
                score = f"{r.away_score}-{r.home_score}"
                decision = r.decision
            clv, close_price = None, None
            if gid in closing:
                ch, ca = closing[gid]
                q = market.devig([ch, ca])
                if q:
                    close_price = ch if side == 'home' else ca
                    clv = (q[0] if side == 'home' else q[1]) * dec - 1
            ev = snap.get(f'{side}_ev_pct')
            ev = float(ev) / 100 if ev is not None and not pd.isna(ev) else None
            sid = int(str(gid)[:4])
            bets.append({
                'gameId': gid, 'season': f"{sid}-{str(sid + 1)[2:]}", 'gameType': str(gid)[4:6],
                'date': (r.date if r is not None else str(snap['start_ts'].tz_convert('US/Eastern').date())),
                'startUtc': snap['start_ts'].isoformat().replace('+00:00', 'Z'),
                'snapshotUtc': snap['snapshot_utc'].isoformat().replace('+00:00', 'Z'),
                'team': team, 'opponent': opp, 'side': side,
                'stake_units': float(units), 'price': float(price), 'decimal_price': dec,
                'ev_at_bet': ev, 'ev_bucket': _bucket(ev if ev is not None else -1, EV_BUCKETS),
                'stake_bucket': _bucket(float(units), STAKE_BUCKETS),
                'model_prob': float(snap['p_home']) if side == 'home' else 1 - float(snap['p_home']),
                'result': result, 'profit_units': profit, 'final': score, 'decision': decision,
                'closing_price': close_price, 'clv': clv,
                'model_version': snap['model_version'] if isinstance(snap.get('model_version'), str) else None,
            })
    bets.sort(key=lambda b: (b['date'], b['gameId']))
    seasons = {}
    for b in bets:
        seasons.setdefault(b['season'], []).append(b)
    from season import SEASON_LABEL
    seasons.setdefault(SEASON_LABEL, [])
    finished = [b for b in bets if pd.Timestamp(b['startUtc']) < pd.Timestamp(now) - pd.Timedelta(hours=6)]
    joined = [b for b in finished if b['result'] != 'pending']
    ok, reasons = market.site_gate()
    ledger = {
        'schema_version': SCHEMA_VERSION,
        'generated_at': now.isoformat(),
        'unit': '1 unit = 1% of bankroll ($5 in the SiteHistory snapshots)',
        'disclaimer': ('For information and entertainment only. Past results do not predict future results. '
                       'Bet sizes are hidden while the model has not proven an edge over the market.'),
        'source': 'last pregame SiteHistory snapshot per NHL gameId; results from NHL final scores',
        'clv_note': (None if closing else
                     'Closing prices are recorded from 2026-27 on (odds_closing.json); earlier bets have no CLV.'),
        'join': {'bets_on_finished_games': len(finished), 'graded': len(joined),
                 'join_rate': (len(joined) / len(finished)) if finished else None},
        'gate': {'open': ok, 'reasons': reasons},
        'seasons': {s: {'summary': summarize(v), 'bets': v} for s, v in sorted(seasons.items())},
    }
    return ledger


def write_ledger(path=OUT_PATH, **kw):
    from model_report import round_floats, write_if_changed
    led = round_floats(build_ledger(**kw))
    if not write_if_changed(path, led, indent=1):
        print("[bet_ledger] unchanged except generated_at - not rewritten")
    for s, v in led['seasons'].items():
        sm = v['summary']
        print(f"[bet_ledger] {s}: {sm['n_bets']} bets, record {sm['record']}, profit {sm['units_profit']}u, "
              f"ROI {sm['roi']} CI {sm['roi_ci']}")
    print(f"[bet_ledger] join rate {led['join']}")
    return led


if __name__ == '__main__':
    write_ledger()
