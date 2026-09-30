"""fetch_clinch_status.py - official clinch / elimination indicators.

Writes public/data/clinch_status.json:

    {"season_id": "20262027", "generated_at": "2026-...Z",
     "teams": {"COL": "z", "VAN": "e", "TOR": null, ...}}

NHL clinchIndicator values (api-web standings):
  p  Presidents' Trophy     z  clinched division
  y  clinched conference    x  clinched a playoff spot
  e  eliminated             null  still competing

The standings are requested for today's NHL date and must be for
``season.SEASON_ID``; the '/now' endpoint keeps serving last season's final
table around opening night, which is how 2025-26 'e'/'p' badges leaked into
October.  Runs in the lite and the full update.
"""
from __future__ import annotations

import json
import os

from season import SEASON_ID, today_local

BASE_URL = "https://api-web.nhle.com/v1"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(_ROOT, "public", "data", "clinch_status.json")


def get_url(url: str):
    from http_utils import try_get_json
    return try_get_json(url, ua="plain")


def clinch_map(standings_payload, season_id=SEASON_ID):
    """{TRI: indicator or None} for rows of ``season_id`` only."""
    out = {}
    for team in (standings_payload or {}).get("standings", []) or []:
        if str(team.get("seasonId")) != str(season_id):
            continue
        abbrev = team.get("teamAbbrev", {})
        if isinstance(abbrev, dict):
            abbrev = abbrev.get("default", "")
        if abbrev:
            out[abbrev] = team.get("clinchIndicator") or None
    return out


def write(teams, path=OUTPUT_FILE):
    from io_utils import utc_now_iso
    try:
        with open(path) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    # Rewrite only when an indicator (or the season) changes, so hourly
    # runs don't churn the file with a new timestamp.
    if isinstance(old, dict) and old.get("season_id") == SEASON_ID and old.get("teams") == teams:
        return False
    doc = {"season_id": SEASON_ID, "generated_at": utc_now_iso(), "teams": dict(sorted(teams.items()))}
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, path)
    return True


def main():
    print("--- Fetching Clinch/Elimination Status ---")
    data = get_url(f"{BASE_URL}/standings/{today_local().isoformat()}")
    teams = clinch_map(data)
    if len(teams) < 32:
        print(f"  standings for {SEASON_ID} incomplete ({len(teams)} teams) - trying /standings/now")
        teams = clinch_map(get_url(f"{BASE_URL}/standings/now"))
    if len(teams) < 32:
        print(f"FAILED: no {SEASON_ID} standings")
        return {"status": "fail", "reason": f"no {SEASON_ID} standings ({len(teams)} teams)"}
    changed = write(teams)
    clinched = sorted(t for t, v in teams.items() if v and v != "e")
    eliminated = sorted(t for t, v in teams.items() if v == "e")
    print(f"Clinched ({len(clinched)}): {', '.join(clinched) or '-'}; eliminated ({len(eliminated)}): "
          f"{', '.join(eliminated) or '-'}; {'written' if changed else 'unchanged'}")
    return {"status": "ok", "rows_written": len(teams) if changed else 0}


if __name__ == "__main__":
    main()
