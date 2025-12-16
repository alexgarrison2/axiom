
import urllib.request
import json
import ssl

ssl._create_default_https_context = ssl._create_unverified_context
BASE_URL = "https://api-web.nhle.com/v1"

def get_schedule(date_str):
    url = f"{BASE_URL}/schedule/{date_str}"
    print(f"Fetching {url}")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error: {e}")
        return None

data = get_schedule("2025-12-10")
if data and "gameWeek" in data:
    for day in data["gameWeek"]:
        if day["date"] == "2025-12-10":
            for game in day["games"]:
                h_id = game["homeTeam"]["id"]
                a_id = game["awayTeam"]["id"]
                print(f"Game {game['id']}: {game['awayTeam'].get('commonName','?')} ({a_id}) @ {game['homeTeam'].get('commonName','?')} ({h_id})")
