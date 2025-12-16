import json
import csv
import sys

# Since we don't have the raw JSON PBP easily accessible (it's in the CSV now),
# we might need to parse the CSV carefully or fetch the JSON again if possible.
# But `nhl_season_2025_2026_pbp.csv` contains the raw JSON structure? No, it's flattened.
# BUT we have `nhl_scraper_poc.py` which can define how to read the CSV or fetch freshly.
# Let's fetch the game fresh to be sure of the structure and values.

import urllib.request
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

BASE_URL = "https://api-web.nhle.com/v1"
GAME_ID = 2025020240

def get_pbp(game_id):
    url = f"{BASE_URL}/gamecenter/{game_id}/play-by-play"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error: {e}")
        return None

data = get_pbp(GAME_ID)
if not data:
    sys.exit(1)

print(f"Game: {GAME_ID}")
plays = data.get("plays", [])

print("\n--- Penalties ---")
for p in plays:
    if p.get("typeCode") == 509:
        details = p.get("details", {})
        time = p.get("timeInPeriod")
        period = p.get("periodDescriptor", {}).get("number")
        desc = p.get("typeDescKey")
        duration = details.get("duration")
        owner = details.get("eventOwnerTeamId")
        print(f"P{period} {time} | Owner: {owner} | Dur: {duration} | Desc: {details.get('descKey')} | Code: {p.get('situationCode')}")

print("\n--- Goal 14:28 P3 ---")
for p in plays:
    if p.get("typeCode") == 505:
        time = p.get("timeInPeriod")
        period = p.get("periodDescriptor", {}).get("number")
        if period == 3 and time == "14:28":
             print(json.dumps(p, indent=2))
