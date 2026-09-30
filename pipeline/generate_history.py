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
"""

from __future__ import annotations

import json
import math
import os
import sys

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
ARCHIVE_DIR = os.path.join(ROOT, 'data', 'archive')
NON_NHL_ARCHIVE = os.path.join(ARCHIVE_DIR, 'prediction_history_non_nhl.json')
PREDICTIONS_CSV = os.path.join(ROOT, 'data', 'predictions_detailed.csv')
TEAMS_CSV = os.path.join(SCRIPT_DIR, 'nhl_teams.csv')

CLEAN_START = {'20262027': '2026-09-29'}
# Predicted after puck drop on opening night (live odds, 2025-26 context).
EXCLUDED_GAME_IDS = {2026020001, 2026020002}


def season_label(game_id) -> str:
    y = int(str(game_id)[:4])
    return f"{y}-{str(y + 1)[2:]}"


def _round(x, n):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)


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
    return h[['game_id', 'date', 'team', 'opponent', 'home_score', 'away_score', 'decision',
              'home_won', 'result']].rename(columns={'team': 'home', 'opponent': 'away'})


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
    return {
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
    if verbose:
        live = sum(1 for r in out if not r['retro'])
        print(f"[history] {len(out)} rows: {live} live snapshots, {len(out) - live} retro; "
              f"{len(non_nhl)} non-NHL archived; {len(unmatched)} unmatched kept in archive")
    if write:
        with open(HISTORY_PATH, 'w') as f:
            json.dump(out, f, indent=2)
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


if __name__ == '__main__':
    generate_history()
