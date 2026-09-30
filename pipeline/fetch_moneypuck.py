"""
fetch_moneypuck.py

Downloads league-wide per-player statistics from MoneyPuck.com using the
three bulk files listed on https://moneypuck.com/data.htm (data is free for
non-commercial use and must be credited to MoneyPuck.com):

  seasonSummary/{year}/regular/skaters.csv   all skaters, all situations
  seasonSummary/{year}/regular/goalies.csv   all goalies
  playerBios/allPlayersLookup.csv            playerId -> bio lookup

That is at most 3 HTTP requests (plus up to 2 retries each on 429/5xx),
replacing the old 64 per-team URLs that tripped MoneyPuck's rate limit after
~21 teams.  MoneyPuck refreshes nightly, so a fetch within the last
FETCH_MAX_AGE_HOURS is reused instead of downloading again.

Output files (pipeline/, untracked):
  moneypuck_skaters.csv, moneypuck_goalies.csv, moneypuck_bios.csv

A download that is missing teams or rows never overwrites the previous CSV;
the stale flag is recorded in public/data/manifest.json instead.
"""

from season import START_YEAR
import os
from io import StringIO

import pandas as pd

from http_utils import get_text, HttpError
from io_utils import atomic_write_csv, record_source, source_age_hours, mark_stale

CURRENT_SEASON = START_YEAR

BASE = "https://moneypuck.com/moneypuck/playerData"
SKATERS_URL = BASE + "/seasonSummary/{year}/regular/skaters.csv"
GOALIES_URL = BASE + "/seasonSummary/{year}/regular/goalies.csv"
BIOS_URL = BASE + "/playerBios/allPlayersLookup.csv"

FETCH_MAX_AGE_HOURS = 20       # at most one download per day
MIN_TEAMS = 32
MIN_SKATER_PLAYERS = 700       # distinct skaters in a complete season file
RETRIES = 3                    # 1 try + 2 retries with exponential backoff


def _csv(url):
    text = get_text(url, retries=RETRIES, backoff=2.0, timeout=30)
    return pd.read_csv(StringIO(text))


def _skater_check(df):
    if df.empty or "team" not in df.columns:
        return "empty or missing team column"
    teams = df["team"].nunique()
    players = df["playerId"].nunique() if "playerId" in df.columns else 0
    if teams < MIN_TEAMS:
        return f"only {teams} teams"
    if players < MIN_SKATER_PLAYERS:
        return f"only {players} players"
    return None


def fetch_moneypuck(season=CURRENT_SEASON, output_dir=None, force=False):
    """Fetch MoneyPuck bulk files. Returns a status dict:
    {'status': 'ok'|'skip'|'fail', 'rows_written': int, 'requests': int, 'reason': str}"""
    output_dir = output_dir or os.path.dirname(os.path.abspath(__file__))
    sk_path = os.path.join(output_dir, "moneypuck_skaters.csv")
    gk_path = os.path.join(output_dir, "moneypuck_goalies.csv")
    bio_path = os.path.join(output_dir, "moneypuck_bios.csv")

    age = source_age_hours("moneypuck")
    if not force and age is not None and age < FETCH_MAX_AGE_HOURS and os.path.exists(sk_path):
        print(f"MoneyPuck fetched {age:.1f}h ago — reusing {os.path.basename(sk_path)}")
        return {"status": "skip", "rows_written": 0, "requests": 0, "reason": "fresh"}

    print("=== Fetching MoneyPuck bulk player data ===")
    import http_utils
    n0 = len(http_utils.REQUEST_LOG)
    rows = 0

    try:
        skaters = _csv(SKATERS_URL.format(year=season))
    except (HttpError, ValueError) as e:
        mark_stale("moneypuck_skaters.csv", f"download failed: {e}")
        print(f"  [FAIL] skaters.csv: {e} — keeping previous file")
        return {"status": "fail", "rows_written": 0,
                "requests": len(http_utils.REQUEST_LOG) - n0, "reason": str(e)}

    if not atomic_write_csv(sk_path, skaters, validator=_skater_check, label="moneypuck_skaters.csv"):
        return {"status": "fail", "rows_written": 0,
                "requests": len(http_utils.REQUEST_LOG) - n0, "reason": _skater_check(skaters)}
    rows += len(skaters)
    print(f"  ✓ moneypuck_skaters.csv: {len(skaters)} rows, {skaters['team'].nunique()} teams, "
          f"{skaters['playerId'].nunique()} players")

    try:
        goalies = _csv(GOALIES_URL.format(year=season))
        if atomic_write_csv(gk_path, goalies, min_rows=60, label="moneypuck_goalies.csv"):
            rows += len(goalies)
            print(f"  ✓ moneypuck_goalies.csv: {len(goalies)} rows")
    except (HttpError, ValueError) as e:
        print(f"  [WARN] goalies.csv: {e}")

    try:
        bios = _csv(BIOS_URL)
        if atomic_write_csv(bio_path, bios, min_rows=1000, label="moneypuck_bios.csv"):
            print(f"  ✓ moneypuck_bios.csv: {len(bios)} rows")
    except (HttpError, ValueError) as e:
        print(f"  [WARN] player bios: {e}")

    n_req = len(http_utils.REQUEST_LOG) - n0
    record_source("moneypuck", season=season, requests=n_req)
    print(f"=== MoneyPuck fetch complete ({n_req} requests) ===\n")
    return {"status": "ok", "rows_written": rows, "requests": n_req, "reason": ""}


if __name__ == "__main__":
    import sys
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    fetch_moneypuck(force="--force" in sys.argv)
