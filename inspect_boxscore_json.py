import urllib.request
import json
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

url = "https://api-web.nhle.com/v1/gamecenter/2025020001/boxscore"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})

try:
    with urllib.request.urlopen(req) as response:
        data = json.load(response)
        print("Top level keys:", data.keys())
        print("playerByGameStats keys:", data.get('playerByGameStats', {}).keys())
        # Try away team too
        skaters = data.get('playerByGameStats', {}).get('awayTeam', {}).get('forwards', [])
        if skaters:
             print("Keys for away skater:", skaters[0].keys())
             print("Sample away skater data:", json.dumps(skaters[0], indent=2))

except Exception as e:
    print(f"Error: {e}")
