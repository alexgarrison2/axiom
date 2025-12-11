import urllib.request
import json
import ssl

# Bypass SSL context if needed
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Common helper for requests
def make_request(url):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_player_id(name):
    # Use NHL search suggestion endpoint
    url = f"https://api-web.nhle.com/v1/wsc/search/suggest?query={name}"
    data = make_request(url)
    if data:
        print(f"Search Results for {name}:")
        print(json.dumps(data, indent=2))
    return data

def get_game_log(player_id, season="20242025"):
    # Game Log Endpoint
    url = f"https://api-web.nhle.com/v1/player/{player_id}/game-log/{season}/2"
    return make_request(url)

if __name__ == "__main__":
    # 1. Search for Igor Shesterkin
    print("--- Searching for Igor Shesterkin ---")
    results = get_player_id("Shesterkin")
    
    # 2. Extract ID (Manual check of output structure first)
    if results:
         # Try to find ID in 'people' or typical list
         # Assuming first result
        pass

    # 3. Test Game Log (Using a known ID if search fails, let's use 8478048 for Shesterkin if search works)
    # Igor Shesterkin ID: 8478048
    print("\n--- Fetching Game Log for ID 8478048 ---")
    log = get_game_log(8478048, "20242025") # Current season
    
    if log:
        # Check opponent structure
        # 'games': [ { 'opponentCommonName': 'Stars', ... } ]
        games = log.get('gameLog', [])
        print(f"Found {len(games)} games.")
        if games:
            print("Sample Game 0:", json.dumps(games[0], indent=2))
            
            # Filter for specific opponent (e.g. 'Stars')
            opp = 'Stars'
            vs_games = [g for g in games if g.get('opponentCommonName', {}).get('default') == opp or g.get('opponentAbbrev') == 'DAL']
            print(f"Games vs {opp}: {len(vs_games)}")
