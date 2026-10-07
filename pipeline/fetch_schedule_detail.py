#!/usr/bin/env python3
"""
fetch_schedule_detail.py - the full regular-season and playoff schedule with
venues, for the team page's Schedule tab (utils/team-stats/schedule-server.ts).

One request per club to api-web.nhle.com/v1/club-schedule-season/<TRI>/<season>
(always with an explicit season id: the `/now` variants keep serving last
season around opening night), merged by game id, written to
pipeline/data/schedule_detail_<season>.json:

    {season_id, fetched_at, games: [
        {id, type, date, start, home, away, venue, tz, neutral, event,
         state, hs, as, last}, ...]}

`date` is the NHL's game date, `start` the UTC puck drop, `tz` the venue's
IANA zone, `neutral` the NHL's neutral-site flag and `event` the special
event name (Winter Classic, Stadium Series, Global Series, Heritage Classic)
or null. Scores ride along but the site takes results from the scraped game
log, so a stale score here is harmless.

The current season is refreshed on every full run; the previous season only
while its file is missing or still has games that are not final.

Run from pipeline/:  python3 fetch_schedule_detail.py [season_id ...]
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

from season import SEASON_ID

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, 'data')
TEAMS = ('ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT '
         'PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH').split()


def _get(url, retries=3):
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
    ev = g.get('specialEvent') or {}
    name = ((ev.get('name') or {}).get('default') or '').strip() or None
    return {
        'id': int(g['id']),
        'type': int(g.get('gameType', 0)),
        'date': g.get('gameDate'),
        'start': g.get('startTimeUTC'),
        'home': g['homeTeam'].get('abbrev'),
        'away': g['awayTeam'].get('abbrev'),
        'venue': (g.get('venue') or {}).get('default'),
        'tz': g.get('venueTimezone'),
        'neutral': bool(g.get('neutralSite')),
        'event': name,
        'state': g.get('gameState'),
        'hs': g['homeTeam'].get('score'),
        'as': g['awayTeam'].get('score'),
        'last': (g.get('gameOutcome') or {}).get('lastPeriodType'),
    }


def path_for(season_id: str) -> str:
    return os.path.join(OUT_DIR, f'schedule_detail_{season_id}.json')


def fetch_season(season_id: str) -> dict:
    games = {}
    for tri in TEAMS:
        data = _get(f'https://api-web.nhle.com/v1/club-schedule-season/{tri}/{season_id}')
        for g in data.get('games', []):
            if str(g.get('season')) != str(season_id) or int(g.get('gameType', 0)) not in (2, 3):
                continue
            games[int(g['id'])] = _slim(g)
    rows = sorted(games.values(), key=lambda r: (r['start'] or '', r['id']))
    return {'season_id': str(season_id), 'fetched_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'games': rows}


def needs_refresh(season_id: str) -> bool:
    p = path_for(season_id)
    if not os.path.exists(p):
        return True
    try:
        with open(p) as f:
            doc = json.load(f)
    except Exception:
        return True
    return any(g.get('state') not in ('OFF', 'FINAL') for g in doc.get('games', []))


def write(season_id: str) -> int:
    doc = fetch_season(season_id)
    regular = sum(1 for g in doc['games'] if g['type'] == 2)
    if regular < 1000:  # a partial or failed pull must not replace a good file
        raise RuntimeError(f'{season_id}: only {regular} regular-season games')
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = path_for(season_id) + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(tmp, path_for(season_id))
    print(f'[schedule_detail] {season_id}: {len(doc["games"])} games ({regular} regular season)')
    return len(doc['games'])


def main(seasons=None):
    if not seasons:
        y = int(SEASON_ID[:4])
        prev = f'{y - 1}{y}'
        seasons = [SEASON_ID] + ([prev] if needs_refresh(prev) else [])
    n = 0
    for s in seasons:
        n += write(str(s))
    return {'status': 'ok', 'rows_written': n}


if __name__ == '__main__':
    main(sys.argv[1:] or None)
