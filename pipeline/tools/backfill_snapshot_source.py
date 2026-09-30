"""Back-fill ``market_source`` on SiteHistory snapshot rows written before the column existed.

    cd pipeline && python3 tools/backfill_snapshot_source.py 2026-09-29 2026-09-30

A snapshot row gets the source only when a committed version of
public/data/predictions_detailed.csv has the same game, the same moneyline and
a ``market_fetched_at`` no more than 30 minutes before the snapshot time; it is
never guessed. Rows that already carry a source are left alone. Reads git
history, so run it from a checkout with that history.
"""
from __future__ import annotations

import csv
import io
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR)
ROOT = os.path.dirname(SCRIPT_DIR)

import snapshot_predictions as SP  # noqa: E402

PRED_PATH = 'public/data/predictions_detailed.csv'
HISTORY_DIR = os.path.join(ROOT, 'public', 'data', 'SiteHistory')
WINDOW = timedelta(minutes=30)


def _ts(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)
    except ValueError:
        return None


def _odds(v) -> int | None:
    try:
        return int(float(str(v).replace('+', '').replace('−', '-')))
    except (TypeError, ValueError):
        return None


def _git(*args: str) -> str:
    return subprocess.run(['git', '-C', ROOT, *args], check=True, capture_output=True, text=True).stdout


def committed_quotes(date: str) -> list[dict]:
    """Every (game, moneyline, source, fetched_at) the predictions CSV carried for ``date`` in git history."""
    day = datetime.fromisoformat(date)
    since = (day - timedelta(days=1)).strftime('%Y-%m-%d')
    until = (day + timedelta(days=2)).strftime('%Y-%m-%d')
    out = []
    for sha in _git('log', '--format=%H', f'--since={since}', f'--until={until}', '--', PRED_PATH).split():
        try:
            text = _git('show', f'{sha}:{PRED_PATH}')
        except subprocess.CalledProcessError:
            continue
        for r in csv.DictReader(io.StringIO(text)):
            if r.get('game_date') != date or not r.get('market_source'):
                continue
            out.append({'gameid': r.get('game_id', ''), 'source': r['market_source'].strip(),
                        'at': _ts(r.get('market_fetched_at')),
                        'away': _odds(r.get('away_vegas_odds')), 'home': _odds(r.get('home_vegas_odds'))})
    return [q for q in out if q['at'] is not None]


def backfill(date: str, quotes: list[dict] | None = None, history_dir: str = HISTORY_DIR) -> int:
    path = os.path.join(history_dir, f'{date}.csv')
    with open(path, newline='') as f:
        rows = list(csv.DictReader(f))
    quotes = committed_quotes(date) if quotes is None else quotes
    filled = 0
    for row in rows:
        if (row.get('market_source') or '').strip():
            continue
        at = _ts(row.get('timestamp_utc'))
        if at is None:
            continue
        away, home = _odds(row.get('away_Odds')), _odds(row.get('home_Odds'))
        hits = [q for q in quotes if q['gameid'] == row.get('gameid') and q['away'] == away and q['home'] == home
                and timedelta(0) <= at - q['at'] <= WINDOW]
        if hits:
            row['market_source'] = max(hits, key=lambda q: q['at'])['source']
            filled += 1
    if not filled:
        return 0  # leave the file byte-for-byte as it was
    tmp = path + '.tmp'
    with open(tmp, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=SP.FIELDNAMES, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)
    return filled


if __name__ == '__main__':
    for d in sys.argv[1:]:
        print(f'[backfill_snapshot_source] {d}: {backfill(d)} row(s) got a market_source')
