import urllib.request
import json
import datetime
import ssl
import os

def fetch_full_schedule():
    """
    Fetches the full NHL schedule for the 2025-2026 season (now until end of regular season).
    Saves to 'data/remaining_schedule.json'.
    """
    print("Fetching full remaining season schedule...")
    
    # NHL API Endpoint for full season schedule for a team implies we might need to iterate or fetch a large range.
    # The 'schedule' endpoint handles date ranges.
    # Regular Season ends approx mid-April 2026.
    # Let's fetch from "today" until "2026-04-18" (safe buffer).
    
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    end_date_str = "2026-04-18"
    
    # Note: The new NHL API doesn't support massive date ranges in one 'schedule' call often (it returns a week).
    # However, 'club-schedule-season' returns the whole season for a TEAM.
    # Fetching 'schedule' by date implies iterating weeks.
    # STRATEGY: Use the 'schedule' endpoint but we might need to iterate if it truncates.
    # Actually, the 'schedule' endpoint usually returns a 'gameWeek'. 
    # To get the FULL season in one go, the best known way in the new API is to fetch the 'season schedule' for ALL teams?
    # No, that's inefficient. 
    # Better approach: Iterate locally from Today to End of Season in 1-week chunks?
    # OR: Use the 'club-schedule-season' for ONE team (e.g. BOS) to get dates, but that doesn't give all matchups? 
    # Wait, 'club-schedule-season' gives THAT team's games.
    # iterating weeks is safer for "League Key".
    
    # Let's try to find an endpoint that gives the full league schedule.
    # https://api-web.nhle.com/v1/schedule/2025-12-01 gives a week.
    
    # Efficient Strategy: 
    # Since we need a robust simulator, let's fetch week-by-week.
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    all_games = []
    
    current_date = datetime.datetime.now()
    end_date = datetime.datetime(2026, 4, 18)
    
    # We will loop by weeks.
    # The API returns the week containing the date provided.
    # We need to be careful not to fetch the same week twice or miss one.
    # API usually returns "nextStartDate" which helps.
    
    query_date_str = today_str
    
    while True:
        print(f"  Fetching week starting {query_date_str}...")
        url = f"https://api-web.nhle.com/v1/schedule/{query_date_str}"
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx) as response:
                data = json.load(response)
                
            # Parse games from this week
            game_weeks = data.get('gameWeek', [])
            
            for day in game_weeks:
                date_val = day['date']
                # Only keep future/today games (simulation purposes)
                # But strict "greater than now" might exclude today's games if running early.
                # Let's keep EVERYTHING returned and filter later if needed.
                if date_val < today_str:
                    continue
                    
                for game in day.get('games', []):
                    # Only Regular Season (Type 2)
                    if game.get('gameType') != 2:
                        continue
                        
                    # Basic Info needed for simulator
                    g = {
                        'id': game['id'],
                        'date': date_val,
                        'home': game['homeTeam']['abbrev'],
                        'away': game['awayTeam']['abbrev'],
                        'gameState': game.get('gameState', 'FUT'), # FUT, OFF, FINAL
                        # We might need scores if we are backfilling "today" that just finished?
                        # Simulator usually cares about "Remaining".
                        # If a game is FINAL, we shouldn't simulate it, we should count it in standings.
                        # This script fetches "Remaining" implies generally future.
                        # If 'gameState' is FINAL, we skip?
                        # BETTER: Fetch EVERYTHING from today onwards, let simulator filter FINALs based on live standings update.
                    }
                    all_games.append(g)
            
            # Pagination
            next_start = data.get('nextStartDate')
            if not next_start:
                break
                
            # Check if we passed our end date
            # next_start is "2025-12-08" string
            ns_dt = datetime.datetime.strptime(next_start, "%Y-%m-%d")
            if ns_dt > end_date:
                break
                
            query_date_str = next_start
            
        except Exception as e:
            print(f"Error fetching schedule at {query_date_str}: {e}")
            break
            
    print(f"Fetched {len(all_games)} remaining regular season games.")
    
    # Save
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    out_path = os.path.join(data_dir, "remaining_schedule.json")
    
    with open(out_path, 'w') as f:
        json.dump(all_games, f, indent=4)
        
    print(f"Saved to {out_path}")

if __name__ == "__main__":
    fetch_full_schedule()
