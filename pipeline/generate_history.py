#!/usr/bin/env python3
"""
generate_history.py - the honest prediction record (data/prediction_history.json).

Rules
-----
* One row per NHL game (game types 02/03 only), keyed by the 10-digit gameId.
* A row's prediction comes from the LAST SiteHistory snapshot taken before
  puck drop (startTimeUTC).  Those rows are ``retro: false`` and are the only
  rows that count in headline stats.
* Rows already in the file that have no pregame snapshot were back-filled
  after the fact (2025-26 before 2026-03-05, a different formula with
  hindsight goalies).  They are kept for reference, tagged ``retro: true``.
* The official final is stored: shootout winners get the deciding goal
  (2025-10-28 PIT@PHI is 3-2 PHI, decision 'SO'), plus decision REG/OT/SO.
* Non-NHL rows (2026 Olympic tournament) are moved to
  data/archive/prediction_history_non_nhl.json, never deleted.
* 2026-27 starts clean on 2026-09-29: only live pregame snapshots, and games
  predicted after puck drop (2026020001 FLA@CAR, 2026020002 MTL@TOR - see
  A2 'no_pregame_prediction') are excluded.
* Only completed games are written; a live snapshot waits in SiteHistory
  until the result is scraped.
* Every completed game of a clean-start season that is NOT graded is listed
  with a reason in data/prediction_history_meta.json ('not_graded'), so the
  site can say "Not graded: no pregame prediction" instead of silently
  dropping it.  The meta file also records when the graded set last changed
  (``graded_changed_at``); validate_outputs.py uses it to catch a
  model_report.json / bet_ledger.json that was not rebuilt afterwards.
"""

from __future__ import annotations

import hashlib
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

import features as F  # noqa: E402
import market  # noqa: E402
import site_history as S  # noqa: E402

HISTORY_PATH = os.path.join(ROOT, 'data', 'prediction_history.json')
META_PATH = os.path.join(ROOT, 'data', 'prediction_history_meta.json')
ARCHIVE_DIR = os.path.join(ROOT, 'data', 'archive')
NON_NHL_ARCHIVE = os.path.join(ARCHIVE_DIR, 'prediction_history_non_nhl.json')
PREDICTIONS_CSV = os.path.join(ROOT, 'data', 'predictions_detailed.csv')
TEAMS_CSV = os.path.join(SCRIPT_DIR, 'nhl_teams.csv')

CLEAN_START = {'20262027': '2026-09-29'}
# Predicted after puck drop on opening night (live odds, 2025-26 context).
EXCLUDED_GAME_IDS = {2026020001, 2026020002}

NOT_GRADED_REASONS = {
    'snapshot_after_start': 'Not graded: the prediction was first published after puck drop',
    'no_snapshot': 'Not graded: no pregame prediction was saved for this game',
}


def season_label(game_id) -> str:
    y = int(str(game_id)[:4])
    return f"{y}-{str(y + 1)[2:]}"


def _round(x, n):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)


def is_lean(home_pct) -> bool:
    """False for a forecast within 1 pt of 50% (the site's coin-flip rule, lib/matchup/format.ts
    isCoinFlip): no side was favoured, so the row is not graded as a pick. Brier and log loss
    still count it."""
    return abs(round(float(home_pct), 6) - 50) >= 1


def load_results() -> pd.DataFrame:
    """Completed NHL games from the gamestats archive + current season (home rows)."""
    g = F.load_gamestats(SCRIPT_DIR)
    h = g[g['home_away'] == 'Home'].copy()
    h['decision'] = np.where(h['result'].isin(['SOW', 'SOL']), 'SO',
                             np.where(h['result'].isin(['OTW', 'OTL']), 'OT', 'REG'))
    h['home_won'] = h['result'].isin(F.WIN_RESULTS)
    hs = h['goals_for'].astype(int) + ((h['decision'] == 'SO') & h['home_won']).astype(int)
    as_ = h['goals_ag'].astype(int) + ((h['decision'] == 'SO') & ~h['home_won']).astype(int)
    h['home_score'], h['away_score'] = hs, as_
    h['date'] = h['game_date'].dt.strftime('%Y-%m-%d')
    # regulation and 1st-period goals (game simulator grading); NaN when the file lacks them
    num = lambda c: pd.to_numeric(h[c], errors='coerce') if c in h.columns else np.nan  # noqa: E731
    h['reg_home'] = num('goals_for') - pd.Series(num('goals_for_OT'), index=h.index).fillna(0)
    h['reg_away'] = num('goals_ag') - pd.Series(num('goals_ag_OT'), index=h.index).fillna(0)
    h['p1_home'], h['p1_away'] = num('goals_for_1P'), num('goals_ag_1P')
    return h[['game_id', 'date', 'team', 'opponent', 'home_score', 'away_score', 'decision',
              'home_won', 'result', 'reg_home', 'reg_away', 'p1_home', 'p1_away']].rename(
        columns={'team': 'home', 'opponent': 'away'})


def excluded_by_pipeline() -> set:
    """Games predictions_detailed.csv marks as predicted after puck drop (A2)."""
    ids = set(EXCLUDED_GAME_IDS)
    try:
        df = pd.read_csv(PREDICTIONS_CSV, dtype=str)
        if 'prediction_status' in df.columns:
            bad = df[df['prediction_status'] == 'no_pregame_prediction']
            for col in ('nhl_game_id', 'game_id'):
                if col in bad.columns:
                    ids |= {int(x) for x in bad[col].dropna() if str(x).isdigit() and len(str(x)) == 10}
    except Exception:
        pass
    return ids


def row_from_snapshot(snap, res) -> dict:
    p = float(snap['p_home'])
    home, away = res['home'], res['away']
    pred = home if p > 0.5 else away
    actual = home if res['home_won'] else away
    y = 1.0 if res['home_won'] else 0.0
    q = None
    if not (pd.isna(snap['home_odds']) or pd.isna(snap['away_odds'])) and \
            abs(snap['home_odds']) >= 100 and abs(snap['away_odds']) >= 100:
        q = market.devig([snap['home_odds'], snap['away_odds']])[0]
    pc = min(max(p, 1e-6), 1 - 1e-6)
    pm = snap.get('p_home_model')
    pm = None if pm is None or (isinstance(pm, float) and math.isnan(pm)) or not 0 < pm < 1 else float(pm)
    out = {
        'gameId': int(res['game_id']),
        'season': season_label(res['game_id']),
        'gameType': str(res['game_id'])[4:6],
        'date': res['date'],
        'homeTeam': home, 'awayTeam': away,
        'homeScore': int(res['home_score']), 'awayScore': int(res['away_score']),
        'decision': res['decision'],
        'homeXg': _round(snap['home_xg'], 2), 'awayXg': _round(snap['away_xg'], 2),
        'homeWinProb': round(100 * p, 1),
        'predictedWinner': pred, 'actualWinner': actual,
        'isCorrect': pred == actual,
        'isLean': is_lean(round(100 * p, 1)),
        'brierScore': round((p - y) ** 2, 4),
        'logLoss': round(-(y * math.log(pc) + (1 - y) * math.log(1 - pc)), 4),
        'retro': False,
        'source': 'live_snapshot',
        'snapshotUtc': snap['snapshot_utc'].isoformat().replace('+00:00', 'Z'),
        'startUtc': snap['start_ts'].isoformat().replace('+00:00', 'Z'),
        'marketHomeProb': _round(100 * q, 1) if q is not None else None,
        # Model-only probability before the market blend (snapshots written after A10); None before.
        'modelHomeProb': _round(100 * pm, 1) if pm is not None else None,
        'homeOdds': _round(snap['home_odds'], 0), 'awayOdds': _round(snap['away_odds'], 0),
        'modelVersion': snap['model_version'] if isinstance(snap.get('model_version'), str) else None,
    }
    sim = grade_sim_markets(snap, res)
    if sim is not None:
        # Game simulator (bu/sim): derivative markets graded from the same frozen snapshot
        out['simStatus'] = snap.get('sim_status') if isinstance(snap.get('sim_status'), str) else None
        out['simHomeProb'] = _round(_pct(snap.get('sim_home%')), 1)
        out['simMarkets'] = sim
    return out


def _pct(v):
    try:
        return float(str(v).replace('%', ''))
    except (TypeError, ValueError):
        return None


def _ll(p) -> float | None:
    if p is None or not np.isfinite(p):
        return None
    return round(-math.log(min(max(float(p), 1e-6), 1.0)), 4)


def grade_sim_markets(snap, res) -> dict | None:
    """Grade the simulator's frozen pregame market probabilities (SiteHistory ``sim_markets``)
    against the final: per market the outcome, the model's probability of it, its log loss,
    the naive independent-Poisson log loss with the same win % and total (goal_model), and the
    de-vigged posted price's probability when the book had one.  None without simulator data."""
    raw = snap.get('sim_markets')
    if not isinstance(raw, str) or not raw.strip().startswith('{'):
        return None
    try:
        m = json.loads(raw)
    except ValueError:
        return None
    from bu.sim.validate import naive_summary
    hs, as_ = int(res['home_score']), int(res['away_score'])

    def opt(k):
        v = res.get(k)
        return None if v is None or pd.isna(v) else int(v)
    rh, ra, p1h, p1a = opt('reg_home'), opt('reg_away'), opt('p1_home'), opt('p1_away')
    total = hs + as_
    out = {}
    p_home = float(snap['p_home'])
    tot_exp = m.get('total') or ((snap.get('home_xg') or 0) + (snap.get('away_xg') or 0))
    naive = naive_summary(p_home, float(tot_exp)) if tot_exp and np.isfinite(tot_exp) else None

    def devig(px, k):
        try:
            if any(x is None for x in px):
                return None
            return market.devig(list(px))[k]
        except Exception:
            return None

    def add(name, probs_pct, k, naive_p, px=None):
        if probs_pct is None or any(p is None for p in probs_pct) or k is None:
            return
        p = probs_pct[k] / 100.0
        out[name] = {'outcome': k, 'p': round(p, 4), 'll': _ll(p),
                     'naive_ll': _ll(naive_p) if naive_p is not None else None,
                     'market_p': round(devig(px, k), 4) if px and devig(px, k) is not None else None}
    if rh is not None and ra is not None:
        k = 0 if rh > ra else (1 if rh == ra else 2)
        nv = [naive['reg_home'], naive['reg_tie'], naive['reg_away']][k] if naive else None
        add('reg3', m.get('reg'), k, nv, m.get('reg_px'))
    pl = m.get('pl') or {}
    if pl.get('spread') is not None and pl.get('home') is not None:
        v = (hs - as_) + pl['spread']
        k = 0 if v > 0 else (2 if v < 0 else 1)
        if k != 1:
            probs = [pl['home'], 0.0, pl['away']]
            nv = None
            if naive and abs(abs(pl['spread']) - 1.5) < 1e-9:
                ph = naive['pl_home_m15'] if pl['spread'] < 0 else 1 - naive['pl_away_m15']
                nv = ph if k == 0 else 1 - ph
            add('puckline', probs, k, nv, [pl['px'][0], None, pl['px'][1]] if pl.get('px') else None)
            if 'puckline' in out and pl.get('px') and None not in pl['px']:
                out['puckline']['market_p'] = round(market.devig(list(pl['px']))[0 if k == 0 else 1], 4)
    t = m.get('tot') or {}
    if t.get('line') is not None and t.get('over') is not None:
        k = 0 if total > t['line'] else (1 if total == t['line'] else 2)
        nv = None
        if naive and t['line'] in (5.5, 6.0, 6.5):
            key = f"{t['line']:.1f}".replace('.', '_')
            nv = [naive[f'over_{key}'], naive[f'push_{key}'], naive[f'under_{key}']][k]
        add('total', [t['over'], t['push'], t['under']], k, nv)
        if 'total' in out and k != 1 and t.get('px') and None not in t['px']:
            out['total']['market_p'] = round(market.devig(list(t['px']))[0 if k == 0 else 1], 4)
    if p1h is not None and p1a is not None:
        k = 0 if p1h > p1a else (1 if p1h == p1a else 2)
        nv = [naive['p1_home'], naive['p1_tie'], naive['p1_away']][k] if naive else None
        add('p1_3w', m.get('p1'), k, nv, m.get('p1_px3'))
        if k != 1 and m.get('p1_2w') and None not in m['p1_2w']:
            k2 = 0 if k == 0 else 1
            nv2 = (naive['p1_home_2w'] if k2 == 0 else 1 - naive['p1_home_2w']) if naive else None
            add('p1_2w', m['p1_2w'], k2, nv2, m.get('p1_px2'))
    return out or None


def row_from_retro(old: dict, res) -> dict:
    p = float(old['homeWinProb']) / 100
    home, away = res['home'], res['away']
    pred = old.get('predictedWinner') or (home if p > 0.5 else away)
    actual = home if res['home_won'] else away
    y = 1.0 if res['home_won'] else 0.0
    pc = min(max(p, 1e-6), 1 - 1e-6)
    return {
        'gameId': int(res['game_id']),
        'season': season_label(res['game_id']),
        'gameType': str(res['game_id'])[4:6],
        'date': res['date'],
        'homeTeam': home, 'awayTeam': away,
        'homeScore': int(res['home_score']), 'awayScore': int(res['away_score']),
        'decision': res['decision'],
        'homeXg': old.get('homeXg'), 'awayXg': old.get('awayXg'),
        'homeWinProb': old['homeWinProb'],
        'predictedWinner': pred, 'actualWinner': actual,
        'isCorrect': pred == actual,
        'isLean': is_lean(old['homeWinProb']),
        'brierScore': round((p - y) ** 2, 4),
        'logLoss': round(-(y * math.log(pc) + (1 - y) * math.log(1 - pc)), 4),
        'retro': True,
        'source': 'retro_backfill',
        'snapshotUtc': None, 'startUtc': None,
        'marketHomeProb': None, 'modelHomeProb': None, 'homeOdds': None, 'awayOdds': None,
        'modelVersion': None,
    }


def generate_history(allow_fetch=True, write=True, verbose=True):
    teams = set(pd.read_csv(TEAMS_CSV)['Common Name'])
    results = load_results()
    by_id = {int(r.game_id): r._asdict() for r in results.itertuples(index=False)}
    by_key = {(r.date, r.home, r.away): int(r.game_id) for r in results.itertuples(index=False)}

    existing = []
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            existing = json.load(f)

    sh, _ = S.load_keyed_site_history(allow_fetch=allow_fetch)
    snaps = S.last_pregame(sh) if len(sh) else pd.DataFrame()
    excluded = excluded_by_pipeline()

    rows, non_nhl, unmatched = {}, [], []
    # 1) live snapshots
    for snap in (snaps.to_dict('records') if len(snaps) else []):
        gid = int(snap['game_id'])
        if gid in excluded or gid not in by_id or pd.isna(snap['p_home']):
            continue
        if str(gid)[4:6] not in F.NHL_GAME_TYPES:
            continue
        sid = f"{str(gid)[:4]}{int(str(gid)[:4]) + 1}"
        if sid in CLEAN_START and by_id[gid]['date'] < CLEAN_START[sid]:
            continue
        rows[gid] = row_from_snapshot(snap, by_id[gid])

    # 2) existing rows without a live snapshot -> retro (or archived if non-NHL)
    for old in existing:
        if old.get('homeTeam') not in teams or old.get('awayTeam') not in teams:
            non_nhl.append(old)
            continue
        gid = old.get('gameId') or by_key.get((old.get('date'), old.get('homeTeam'), old.get('awayTeam')))
        if gid is None:
            unmatched.append(old)
            continue
        gid = int(gid)
        if gid in rows or gid in excluded or gid not in by_id:
            if gid not in rows and gid not in by_id:
                unmatched.append(old)
            continue
        if old.get('retro') is False and old.get('source') == 'live_snapshot':
            # a live row whose snapshot file disappeared: keep it as it was
            rows[gid] = old
            continue
        sid = f"{str(gid)[:4]}{int(str(gid)[:4]) + 1}"
        if sid in CLEAN_START:
            continue   # the new season never gets retro rows
        rows[gid] = row_from_retro(old, by_id[gid])

    out = sorted(rows.values(), key=lambda r: (r['date'], r['gameId']))
    not_graded = not_graded_games(by_id, rows, sh, excluded)
    if verbose:
        live = sum(1 for r in out if not r['retro'])
        print(f"[history] {len(out)} rows: {live} live snapshots, {len(out) - live} retro; "
              f"{len(non_nhl)} non-NHL archived; {len(unmatched)} unmatched kept in archive; "
              f"{len(not_graded)} final(s) not graded")
        for g in not_graded:
            print(f"  not graded: {g['gameId']} {g['awayTeam']}@{g['homeTeam']} {g['date']} ({g['reason']})")
    if write:
        with open(HISTORY_PATH, 'w') as f:
            json.dump(out, f, indent=2)
        write_meta(out, not_graded)
        if non_nhl or unmatched:
            os.makedirs(ARCHIVE_DIR, exist_ok=True)
            prev = []
            if os.path.exists(NON_NHL_ARCHIVE):
                with open(NON_NHL_ARCHIVE) as f:
                    prev = json.load(f)
            seen = {(r.get('date'), r.get('homeTeam'), r.get('awayTeam')) for r in prev}
            for r in non_nhl + unmatched:
                k = (r.get('date'), r.get('homeTeam'), r.get('awayTeam'))
                if k not in seen:
                    prev.append(r)
                    seen.add(k)
            with open(NON_NHL_ARCHIVE, 'w') as f:
                json.dump(prev, f, indent=2)
    return out


def not_graded_games(by_id, rows, sh, excluded) -> list:
    """Completed games of a clean-start season that have no graded row, with the reason."""
    seen = {}
    if len(sh) and 'game_id' in sh.columns:
        for r in sh[sh['game_id'].notna()][['game_id', 'snapshot_utc', 'start_ts']].itertuples(index=False):
            pre = pd.notna(r.snapshot_utc) and pd.notna(r.start_ts) and r.snapshot_utc < r.start_ts
            gid = int(r.game_id)
            seen[gid] = seen.get(gid, False) or bool(pre)
    out = []
    for gid, res in by_id.items():
        if gid in rows or str(gid)[4:6] not in F.NHL_GAME_TYPES:
            continue
        sid = f"{str(gid)[:4]}{int(str(gid)[:4]) + 1}"
        if sid not in CLEAN_START or res['date'] < CLEAN_START[sid]:
            continue
        if gid in excluded or (gid in seen and not seen[gid]):
            reason = 'snapshot_after_start'
        else:
            reason = 'no_snapshot'
        out.append({'gameId': int(gid), 'season': season_label(gid), 'gameType': str(gid)[4:6],
                    'date': res['date'], 'homeTeam': res['home'], 'awayTeam': res['away'],
                    'homeScore': int(res['home_score']), 'awayScore': int(res['away_score']),
                    'decision': res['decision'], 'reason': reason, 'label': NOT_GRADED_REASONS[reason]})
    return sorted(out, key=lambda r: (r['date'], r['gameId']))


def graded_fingerprint(rows) -> str:
    key = [(r['gameId'], r['homeWinProb'], r['homeScore'], r['awayScore'], bool(r.get('retro'))) for r in rows]
    return hashlib.md5(json.dumps(sorted(key)).encode()).hexdigest()


def read_meta(path=META_PATH) -> dict:
    try:
        with open(path) as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except Exception:
        return {}


def write_meta(rows, not_graded, path=META_PATH, now=None):
    """data/prediction_history_meta.json: counts, when the graded set last changed, and
    the finals that are not graded (with reasons)."""
    now = (now or datetime.now(timezone.utc)).isoformat().replace('+00:00', 'Z')
    prev = read_meta(path)
    fp = graded_fingerprint(rows)
    changed_at = prev.get('graded_changed_at') if prev.get('fingerprint') == fp else None
    graded = {}
    for r in rows:
        b = graded.setdefault(r['season'], {'live': 0, 'retro': 0})
        b['retro' if r.get('retro') else 'live'] += 1
    live = [r for r in rows if not r.get('retro')]
    newest = max(live, key=lambda r: (r['date'], r['gameId'])) if live else None
    meta = {
        'schema_version': 1,
        'generated_at': now,
        'graded_changed_at': changed_at or now,
        'fingerprint': fp,
        'graded': dict(sorted(graded.items())),
        'newest_graded': ({'gameId': newest['gameId'], 'date': newest['date']} if newest else None),
        'not_graded': not_graded,
    }
    if prev and {k: v for k, v in prev.items() if k != 'generated_at'} == \
            json.loads(json.dumps({k: v for k, v in meta.items() if k != 'generated_at'})):
        return prev   # nothing changed: no rewrite, no data commit
    with open(path, 'w') as f:
        json.dump(meta, f, indent=1)
    return meta


if __name__ == '__main__':
    generate_history()
