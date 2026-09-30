#!/usr/bin/env python3
"""
site_history.py - read the frozen prediction snapshots (public/data/SiteHistory)
and key them to official NHL games.

SiteHistory/<run date>.csv has one row per game per pipeline run: the
probabilities, xG, odds, EV and bet the site showed at that moment.  The run
time is US/Central wall-clock ('07:54') and the game key is a string
('2026-04-01-Canucks-Avalanche'), so this module
  * converts each run to UTC,
  * maps each row to the NHL gameId via the official schedule (cached in
    pipeline/data/nhl_schedule_<season>.json; fetched from api-web.nhle.com
    when missing or stale),
  * keeps only PREGAME snapshots (run time < startTimeUTC).

Everything downstream (prediction history, model report, bet ledger, market
backtest) joins on the 10-digit NHL gameId.
"""

from __future__ import annotations

import glob
import json
import os
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
SITE_DIR = os.path.join(ROOT, 'public', 'data', 'SiteHistory')
SCHEDULE_DIR = os.path.join(SCRIPT_DIR, 'data')
UNIT_DOLLARS = 5.0          # snapshot_predictions.format_bet: 1 unit = $5
RUN_TZ = 'US/Central'

TEAM_NAME_FIX = {'Utah Hockey Club': 'Utah Hockey Club', 'Utah': 'Mammoth'}


# ─── Odds helpers ─────────────────────────────────────────────────────────────

def american_to_decimal(a):
    a = float(a)
    return a / 100 + 1 if a > 0 else 100 / abs(a) + 1


def _num(x):
    try:
        s = str(x).replace('%', '').replace('$', '').replace('+', '').strip()
        return float(s) if s not in ('', 'nan', 'None') else np.nan
    except ValueError:
        return np.nan


# ─── Schedule ─────────────────────────────────────────────────────────────────

def _schedule_path(season_id):
    return os.path.join(SCHEDULE_DIR, f'nhl_schedule_{season_id}.json')


def _fetch_json(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'pony-xg/1.0'})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception as e:  # network hiccup
            last = e
            time.sleep(1 + i)
    raise last


def _slim(g):
    out = g.get('gameOutcome') or {}
    return {
        'start_utc': g.get('startTimeUTC'),
        'game_type': int(g.get('gameType', 0)),
        'home': g['homeTeam']['commonName']['default'],
        'away': g['awayTeam']['commonName']['default'],
        'home_abbrev': g['homeTeam'].get('abbrev'),
        'away_abbrev': g['awayTeam'].get('abbrev'),
        'home_score': g['homeTeam'].get('score'),
        'away_score': g['awayTeam'].get('score'),
        'last_period': out.get('lastPeriodType'),
        'state': g.get('gameState'),
    }


def fetch_schedule(season_id: str, start: date, end: date, existing=None, verbose=True):
    """Fetch weekly schedule pages between start and end (inclusive)."""
    games = dict(existing or {})
    d = start
    while d <= end:
        data = _fetch_json(f'https://api-web.nhle.com/v1/schedule/{d.isoformat()}')
        for day in data.get('gameWeek', []):
            for g in day.get('games', []):
                if str(g.get('season')) != str(season_id):
                    continue
                games[str(g['id'])] = _slim(g)
        d += timedelta(days=7)
    if verbose:
        print(f"[schedule] {season_id}: {len(games)} games ({start}..{end})")
    return games


def load_schedule(season_id: str, refresh_until: date | None = None, allow_fetch=True):
    """{gameId: {...}} for a season, from the committed cache, topped up from the
    API for weeks that are not final yet (up to ``refresh_until``)."""
    path = _schedule_path(season_id)
    games = {}
    if os.path.exists(path):
        with open(path) as f:
            games = json.load(f).get('games', {})
    if not allow_fetch:
        return games
    start_year = int(str(season_id)[:4])
    season_start = date(start_year, 9, 20)
    season_end = date(start_year + 1, 6, 30)
    today = refresh_until or datetime.now(timezone.utc).date()
    end = min(season_end, today + timedelta(days=7))
    pending = [g for g in games.values() if g.get('state') not in ('OFF', 'FINAL')]
    if games and not pending:
        return games
    if pending:
        first_pending = min(datetime.fromisoformat(g['start_utc'].replace('Z', '+00:00')).date()
                            for g in pending if g.get('start_utc'))
        start = max(season_start, first_pending - timedelta(days=1))
    else:
        start = season_start
    if start > end:
        return games
    try:
        games = fetch_schedule(season_id, start, end, existing=games)
    except Exception as e:
        print(f"[schedule] fetch failed for {season_id}: {e} (using cache)")
        return games
    os.makedirs(SCHEDULE_DIR, exist_ok=True)
    with open(path, 'w') as f:
        json.dump({'season_id': str(season_id), 'fetched_at': datetime.now(timezone.utc).isoformat(),
                   'games': dict(sorted(games.items()))}, f, separators=(',', ':'))
    return games


def schedule_frame(season_ids, allow_fetch=True) -> pd.DataFrame:
    rows = []
    for sid in season_ids:
        for gid, g in load_schedule(str(sid), allow_fetch=allow_fetch).items():
            rows.append({'game_id': int(gid), **g})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df['start_ts'] = pd.to_datetime(df['start_utc'], utc=True)
    df['central_date'] = df['start_ts'].dt.tz_convert(RUN_TZ).dt.strftime('%Y-%m-%d')
    return df


# ─── SiteHistory ──────────────────────────────────────────────────────────────

def snapshot_times(dates: pd.Series, stamps: pd.Series) -> pd.Series:
    """UTC time of each snapshot run.

    Two formats are accepted: the legacy US/Central wall clock ('9/29/26' +
    '18:22') and ISO-8601 timestamps ('2026-09-29T23:22:00Z', naive = UTC),
    which A12 switches the snapshot writer to."""
    ts = stamps.astype(str).str.strip()
    iso = ts.str.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}')
    day = pd.to_datetime(dates, format='%m/%d/%y', errors='coerce')
    day = day.fillna(pd.to_datetime(dates, format='%Y-%m-%d', errors='coerce'))
    local = pd.to_datetime(day.dt.strftime('%Y-%m-%d') + ' ' + ts.where(~iso, ''),
                           format='%Y-%m-%d %H:%M', errors='coerce')
    out = local.dt.tz_localize(RUN_TZ, ambiguous='NaT', nonexistent='NaT').dt.tz_convert('UTC')
    if iso.any():
        parsed = pd.Series(pd.NaT, index=ts.index, dtype='datetime64[ns, UTC]')
        for i, v in ts[iso].items():
            try:
                t = pd.Timestamp(v)
                parsed[i] = t.tz_localize('UTC') if t.tzinfo is None else t.tz_convert('UTC')
            except (ValueError, TypeError):
                pass
        out = out.where(~iso, parsed)
    return out


def load_site_history(site_dir=SITE_DIR) -> pd.DataFrame:
    frames = []
    for f in sorted(glob.glob(os.path.join(site_dir, '*.csv'))):
        try:
            d = pd.read_csv(f, dtype=str)
        except Exception:
            continue
        if d.empty:
            continue
        d['file'] = os.path.basename(f)
        frames.append(d)
    if not frames:
        return pd.DataFrame()
    d = pd.concat(frames, ignore_index=True)
    d = d.dropna(subset=['gameid'])
    d = d[d['gameid'].str.strip() != '']
    d['run'] = d['run'].astype(float).astype(int)
    d['snapshot_utc'] = snapshot_times(d['date'], d['timestamp'])
    gid = d['gameid'].astype(str)
    # Newer snapshots carry the NHL id in its own column next to the legacy key.
    if 'nhl_game_id' in d.columns:
        col = d['nhl_game_id'].fillna('').astype(str).str.split('.').str[0].str.strip()
        gid = gid.where(~col.str.fullmatch(r'\d{10}'), col)
    is_nhl_id = gid.str.fullmatch(r'\d{10}')
    d['nhl_game_id'] = np.where(is_nhl_id, gid, None)
    d['game_date'] = np.where(is_nhl_id, None, gid.str[:10])
    d['home'] = d['hometeam'].str.strip().replace(TEAM_NAME_FIX)
    d['away'] = d['awayteam'].str.strip().replace(TEAM_NAME_FIX)
    d['p_home'] = d['home_win%'].map(_num) / 100
    for side in ('home', 'away'):
        d[f'{side}_odds'] = d[f'{side}_Odds'].map(_num)
        d[f'{side}_ev_pct'] = d[f'{side}_EV'].map(_num)
        d[f'{side}_bet_units'] = d[f'{side}_bet'].map(_num) / UNIT_DOLLARS
        d[f'{side}_xg'] = d[f'{side}_xG'].map(_num)
    # Optional columns written by newer pipelines (model vs blended probability).
    for col in ('home_model%', 'home_market%', 'model_version'):
        if col not in d.columns:
            d[col] = np.nan
    d['p_home_model'] = d['home_model%'].map(_num) / 100
    return d


def attach_game_ids(sh: pd.DataFrame, sched: pd.DataFrame) -> pd.DataFrame:
    """Add game_id, start_ts and game_type by (central date, home, away), allowing
    a one-day slip between the site's game date and the schedule's."""
    if sh.empty or sched.empty:
        return sh.assign(game_id=pd.NA, start_ts=pd.NaT, game_type=pd.NA)
    idx = {}
    for r in sched.itertuples(index=False):
        idx.setdefault((r.home, r.away), []).append(r)
    by_id = {int(r.game_id): r for r in sched.itertuples(index=False)}
    gids, starts, types = [], [], []
    for r in sh.itertuples(index=False):
        g = None
        if r.nhl_game_id:
            g = by_id.get(int(r.nhl_game_id))
        elif r.game_date:
            cands = idx.get((r.home, r.away), [])
            best = None
            for c in cands:
                dd = abs((pd.Timestamp(c.central_date) - pd.Timestamp(r.game_date)).days)
                if dd <= 1 and (best is None or dd < best[0]):
                    best = (dd, c)
            g = best[1] if best else None
        gids.append(int(g.game_id) if g is not None else pd.NA)
        starts.append(g.start_ts if g is not None else pd.NaT)
        types.append(int(g.game_type) if g is not None else pd.NA)
    out = sh.copy()
    out['game_id'] = pd.array(gids, dtype='Int64')
    out['start_ts'] = pd.to_datetime(pd.Series(starts, index=out.index), utc=True)
    out['game_type'] = pd.array(types, dtype='Int64')
    return out


def pregame(sh: pd.DataFrame) -> pd.DataFrame:
    """Snapshots taken strictly before puck drop."""
    m = sh['game_id'].notna() & sh['snapshot_utc'].notna() & sh['start_ts'].notna()
    return sh[m & (sh['snapshot_utc'] < sh['start_ts'])]


def last_pregame(sh: pd.DataFrame) -> pd.DataFrame:
    p = pregame(sh).sort_values(['game_id', 'snapshot_utc', 'run'])
    return p.groupby('game_id', as_index=False).tail(1).reset_index(drop=True)


def first_pregame(sh: pd.DataFrame) -> pd.DataFrame:
    p = pregame(sh).sort_values(['game_id', 'snapshot_utc', 'run'])
    return p.groupby('game_id', as_index=False).head(1).reset_index(drop=True)


def season_ids_in(sh: pd.DataFrame):
    dates = pd.to_datetime(sh['game_date'].dropna(), errors='coerce').dropna()
    ids = set()
    for d in dates:
        y = d.year if d.month >= 7 else d.year - 1
        ids.add(f'{y}{y + 1}')
    for g in sh['nhl_game_id'].dropna():
        y = int(str(g)[:4])
        ids.add(f'{y}{y + 1}')
    return sorted(ids)


def load_keyed_site_history(site_dir=SITE_DIR, allow_fetch=True):
    sh = load_site_history(site_dir)
    if sh.empty:
        return sh, pd.DataFrame()
    sched = schedule_frame(season_ids_in(sh), allow_fetch=allow_fetch)
    return attach_game_ids(sh, sched), sched
