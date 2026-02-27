"""
fetch_player_bio.py
Fetches biographical data (age, height, weight, shoots/catches) for all NHL
players from the NHL roster API and writes public/data/player_bio.json.

Output format (keyed by player_id string):
{
  "8482740": {
    "age": 21,
    "height": "6'1\"",
    "weight": 185,
    "shoots": "R"   # "L" | "R"
  },
  ...
}

Run: python3 pipeline/fetch_player_bio.py
"""

import urllib.request
import json
import os
import ssl
from datetime import date
import time

BASE_URL = "https://api-web.nhle.com/v1"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(_ROOT, "public", "data", "player_bio.json")

SEASON = "20252026"

NHL_TEAMS = [
    "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET",
    "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT",
    "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
    "WSH", "WPG",
]

ssl._create_default_https_context = ssl._create_unverified_context


def get_url(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  Error: {e}")
        return None


def calc_age(birth_date_str: str) -> int:
    """Calculate current age from 'YYYY-MM-DD' birth date string."""
    today = date.today()
    bd = date.fromisoformat(birth_date_str)
    return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))


def inches_to_ft(inches: int) -> str:
    """Convert integer inches to e.g. '6\'1"'."""
    return f"{inches // 12}'{inches % 12}\""


def main():
    print("--- Fetching Player Bio Data ---")
    bio: dict = {}

    for team in NHL_TEAMS:
        print(f"  {team}...", end="", flush=True)
        data = get_url(f"{BASE_URL}/roster/{team}/{SEASON}")
        if not data:
            print(" FAILED")
            continue

        count = 0
        for group in ("forwards", "defensemen", "goalies"):
            for player in data.get(group, []):
                pid = str(player.get("id", ""))
                if not pid:
                    continue

                birth = player.get("birthDate", "")
                height_in = player.get("heightInInches")
                weight_lb = player.get("weightInPounds")
                shoots = player.get("shootsCatches", "")

                bio[pid] = {
                    "age": calc_age(birth) if birth else None,
                    "height": inches_to_ft(height_in) if height_in else None,
                    "weight": weight_lb,
                    "shoots": shoots if shoots else None,
                }
                count += 1

        print(f" {count} players")
        time.sleep(0.15)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(bio, f)

    print(f"\nSaved bio for {len(bio)} players → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
