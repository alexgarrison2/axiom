
import urllib.request
import json
import ssl

# Create unverified context for SSL to avoid cert errors
ssl._create_default_https_context = ssl._create_unverified_context

def get_url(url):
    """Helper to fetch URL with proper headers and error handling."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_boxscore(game_id):
    """Fetch boxscore for a specific game."""
    return get_url(f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore")

# Test with Flyers vs Ducks game from Nov 10, 2023
game_id = 2023020208
data = get_boxscore(game_id)

if data:
    # Print keys to see structure, and look specifically for top-level keys or 'gameInfo'
    print("Top level keys:", data.keys())
    if "gameVideo" in data:
         # Reduce noise
         del data["gameVideo"]
    
    # Check explicitly for attendance
    # Often in 'gameInfo' or similar
    print(json.dumps(data, indent=2))
else:
    print("Failed to fetch data")
