
import urllib.request
import json
import ssl

GAME_ID = 2025020687
URL = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/landing"

def check_landing():
    print(f"Fetching {URL}...")
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    req = urllib.request.Request(URL, headers=headers)
    context = ssl._create_unverified_context()
    
    with urllib.request.urlopen(req, context=context) as response:
        data = json.loads(response.read().decode('utf-8'))
        
    # Look for Summary / TeamGameStats
    summary = data.get('summary', {})
    print(f"Summary Keys: {summary.keys()}")
    
    # Check teamGameStats inside summary?
    if 'teamGameStats' in summary:
        print("Found teamGameStats in summary.")
        print(json.dumps(summary['teamGameStats'], indent=2))
        return

    # Check top level
    print(f"Top Level Keys: {data.keys()}")
    
    # Sometimes it's under 'boxscore' -> 'teamGameStats' even in landing?
    # Or just 'teamGameStats' at top level?
    
    if 'teamGameStats' in data:
         print("Found teamGameStats at top level.")
         # Inspect structure
         stats = data['teamGameStats']
         print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    check_landing()
