import json
import urllib.request
import urllib.parse
import ssl

def fetch_nhl_goalie_stats():
    """
    Fetches goalie stats from NHL API for the current season using urllib.
    Returns a dictionary keyed by Goalie Name.
    """
    print("Fetching Goalie Stats from NHL API...")
    
    # Season ID: 20252026
    season_id = "20252026"
    
    # Endpoint
    url = "https://api.nhle.com/stats/rest/en/goalie/summary"
    
    params = {
        "isAggregate": "false",
        "isGame": "false",
        "sort": '[{"property":"wins","direction":"DESC"}]',
        "start": "0",
        "limit": "100", 
        "factCayenneExp": "gamesPlayed>=1",
        "cayenneExp": f"gameTypeId=2 and seasonId<={season_id} and seasonId>={season_id}"
    }

    try:
        query_string = urllib.parse.urlencode(params)
        full_url = f"{url}?{query_string}"
        
        # Add User-Agent header
        req = urllib.request.Request(full_url)
        req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36')
        
        # SSL Context helper
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode('utf-8'))
        
        goalies = data.get('data', [])
        print(f"Found {len(goalies)} goalies.")
        
        stats_map = {}
        
        for g in goalies:
            name = g.get('goalieFullName')
            # Stats
            wins = g.get('wins') or 0
            losses = g.get('losses') or 0
            otl = g.get('otLosses') or 0
            sv_pct = g.get('savePct') or 0.0
            gaa = g.get('goalsAgainstAverage') or 0.0
            
            # Format: (W-L-O) | .SV% | GAA
            sv_str = f"{sv_pct:.3f}".lstrip('0') if sv_pct < 1 else "1.000"
            
            stats_string = f"({wins}-{losses}-{otl}) | {sv_str} | {gaa:.2f}"
            
            stats_map[name] = stats_string
            
        # Save to JSON
        with open('nhl_goalie_stats.json', 'w') as f:
            json.dump(stats_map, f, indent=4)
            
        print("Saved to nhl_goalie_stats.json")
        return stats_map

    except Exception as e:
        print(f"Error fetching goalie stats: {e}")
        return {}

if __name__ == "__main__":
    fetch_nhl_goalie_stats()
