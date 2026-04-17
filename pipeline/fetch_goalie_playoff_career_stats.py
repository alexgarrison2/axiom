"""
fetch_goalie_playoff_career_stats.py
Fetches career NHL playoff stats for all goalies from the NHL stats API.
Outputs: pipeline/goalie_playoff_career_stats.json
         public/data/goalie_playoff_career_stats.json

Format: { "Goalie Full Name": { "record": "W-L", "gp": N, "sv_pct": 0.XXX, "gaa": X.XX, "shutouts": N, "display": "W-L | .XXX | X.XX" } }
"""

import json
import urllib.request
from collections import defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).parent
PUBLIC_DATA  = PIPELINE_DIR / '..' / 'public' / 'data'

HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}


def fetch_all_pages(url_base: str) -> list[dict]:
    """Paginate through all results from an NHL stats API endpoint."""
    rows = []
    start = 0
    batch = 100
    while True:
        url = f"{url_base}&limit={batch}&start={start}"
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
        page = d.get('data', [])
        if not page:
            break
        rows.extend(page)
        start += len(page)
        if start >= d.get('total', 0):
            break
    return rows


def main() -> None:
    print("=== Fetching goalie career playoff stats ===")
    url_base = "https://api.nhle.com/stats/rest/en/goalie/summary?cayenneExp=gameTypeId=3&sort=playerId"
    rows = fetch_all_pages(url_base)
    print(f"  Fetched {len(rows)} season rows")

    career: dict = defaultdict(lambda: {'gp': 0, 'w': 0, 'l': 0, 'ga': 0, 'sv': 0, 'sa': 0, 'so': 0, 'toi': 0})
    pid_to_name: dict[int, str] = {}

    for row in rows:
        pid = row['playerId']
        pid_to_name[pid] = row['goalieFullName']
        career[pid]['gp'] += row.get('gamesPlayed') or 0
        career[pid]['w']  += row.get('wins') or 0
        career[pid]['l']  += row.get('losses') or 0
        career[pid]['ga'] += row.get('goalsAgainst') or 0
        career[pid]['sv'] += row.get('saves') or 0
        career[pid]['sa'] += row.get('shotsAgainst') or 0
        career[pid]['so'] += row.get('shutouts') or 0
        career[pid]['toi'] += row.get('timeOnIce') or 0

    result = {}
    for pid, name in pid_to_name.items():
        c = career[pid]
        if c['gp'] == 0:
            continue
        svp = c['sv'] / c['sa'] if c['sa'] else 0
        gaa = c['ga'] / (c['toi'] / 3600) if c['toi'] else 0
        result[name] = {
            'record':   f"{c['w']}-{c['l']}",
            'gp':       c['gp'],
            'sv_pct':   round(svp, 4),
            'gaa':      round(gaa, 3),
            'shutouts': c['so'],
            'display':  f"{c['w']}-{c['l']} | .{round(svp * 1000):03d} | {gaa:.2f}",
        }

    out_pipeline = PIPELINE_DIR / 'goalie_playoff_career_stats.json'
    out_public   = PUBLIC_DATA  / 'goalie_playoff_career_stats.json'
    out_pipeline.write_text(json.dumps(result, indent=2))
    out_public.write_text(json.dumps(result, indent=2))

    print(f"  ✓ {len(result)} goalies saved → {out_public}")
    print("=== Done ===")


if __name__ == '__main__':
    main()
