"""
fetch_moneypuck.py

Downloads per-player statistics from MoneyPuck.com for all 32 NHL teams.
MoneyPuck provides free CSV downloads with 100+ advanced metrics per player,
updated nightly throughout the season.

Data includes:
  - On-ice / off-ice xGF% (core player impact isolation metric)
  - Individual expected goals (individual shooting threat)
  - High-danger shot and goal metrics
  - Power play and penalty kill contributions
  - Penalty drawn / taken rates
  - Game Score (all-in-one performance)

Output files (written to pipeline/ directory):
  moneypuck_skaters.csv  - All skaters, all situations (5on5, 5on4, 4on5, all)
  moneypuck_goalies.csv  - All goalies
  moneypuck_bios.csv     - Player ID -> name bio lookup

Source: https://moneypuck.com/data.htm
"""

from season import START_YEAR
import urllib.request
import ssl
import pandas as pd
import json
import os
import time
from io import StringIO

# ── Config ──────────────────────────────────────────────────────────────────

# Standard NHL tricodes (MoneyPuck uses same as official NHL API)
NHL_TEAMS = [
    'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL',
    'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
    'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS',
    'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
]

# Season start year: 2025 = 2025-26 season
CURRENT_SEASON = START_YEAR

SKATER_URL  = "https://www.moneypuck.com/moneypuck/playerData/seasonSummary/{year}/regular/teams/skaters/{team}.csv"
GOALIE_URL  = "https://www.moneypuck.com/moneypuck/playerData/seasonSummary/{year}/regular/teams/goalies/{team}.csv"
BIOS_URL    = "https://www.moneypuck.com/moneypuck/playerData/playerBios/allPlayersLookup.csv"

DELAY_SECONDS = 0.25  # polite pause between requests

# ── Helpers ──────────────────────────────────────────────────────────────────

def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _fetch_url(url, timeout=20):
    """Fetch a URL and return raw content string, or None on failure."""
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
        )
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=timeout) as resp:
            return resp.read().decode('utf-8')
    except Exception as e:
        print(f"    [WARN] fetch failed {url}: {e}")
        return None


def _csv_from_url(url):
    """Fetch URL and parse as CSV DataFrame. Returns None on failure."""
    content = _fetch_url(url)
    if not content:
        return None
    try:
        return pd.read_csv(StringIO(content))
    except Exception as e:
        print(f"    [WARN] CSV parse error: {e}")
        return None

# ── Core fetch ────────────────────────────────────────────────────────────────

def fetch_moneypuck(season=CURRENT_SEASON, output_dir=None):
    """
    Fetch MoneyPuck player data for all 32 NHL teams and save CSVs.

    Args:
        season: Season start year (e.g., 2025 for 2025-26)
        output_dir: Directory to write files (defaults to current directory)

    Returns:
        (skaters_df, goalies_df) DataFrames (possibly empty on failure)
    """
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    print("=== Fetching MoneyPuck Player Data ===")
    skater_frames = []
    goalie_frames = []

    for i, team in enumerate(NHL_TEAMS, 1):
        prefix = f"  [{i:2d}/32] {team}"

        # --- Skaters ---
        sk_url = SKATER_URL.format(year=season, team=team)
        sk_df = _csv_from_url(sk_url)
        if sk_df is not None and not sk_df.empty:
            sk_df['team_abbrev'] = team
            skater_frames.append(sk_df)
            print(f"{prefix}  skaters={len(sk_df)}", end='')
        else:
            print(f"{prefix}  (no skaters)", end='')
        time.sleep(DELAY_SECONDS)

        # --- Goalies ---
        gk_url = GOALIE_URL.format(year=season, team=team)
        gk_df = _csv_from_url(gk_url)
        if gk_df is not None and not gk_df.empty:
            gk_df['team_abbrev'] = team
            goalie_frames.append(gk_df)
            print(f"  goalies={len(gk_df)}", end='')
        time.sleep(DELAY_SECONDS)
        print()

    # ── Combine & save skaters ──
    if skater_frames:
        skaters = pd.concat(skater_frames, ignore_index=True)
        out = os.path.join(output_dir, 'moneypuck_skaters.csv')
        skaters.to_csv(out, index=False)
        cols = len(skaters.columns)
        situations = skaters['situation'].value_counts().to_dict() if 'situation' in skaters.columns else {}
        print(f"\n  ✓ moneypuck_skaters.csv: {len(skaters)} rows, {cols} cols  situations={situations}")
    else:
        print("\n  [WARN] No skater data fetched — moneypuck_skaters.csv NOT written")
        skaters = pd.DataFrame()

    # ── Combine & save goalies ──
    if goalie_frames:
        goalies = pd.concat(goalie_frames, ignore_index=True)
        out = os.path.join(output_dir, 'moneypuck_goalies.csv')
        goalies.to_csv(out, index=False)
        print(f"  ✓ moneypuck_goalies.csv: {len(goalies)} rows, {len(goalies.columns)} cols")
    else:
        goalies = pd.DataFrame()

    # ── Player bios ──
    print("  Fetching player bios...")
    bios = _csv_from_url(BIOS_URL)
    if bios is not None and not bios.empty:
        out = os.path.join(output_dir, 'moneypuck_bios.csv')
        bios.to_csv(out, index=False)
        print(f"  ✓ moneypuck_bios.csv: {len(bios)} rows")
    else:
        print("  [WARN] Player bios not fetched")

    print("=== MoneyPuck Fetch Complete ===\n")
    return skaters, goalies


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    fetch_moneypuck()
