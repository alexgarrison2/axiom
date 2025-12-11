
import urllib.request
import json
import csv
import ssl
from datetime import datetime, timedelta

# SSL Context
ssl._create_default_https_context = ssl._create_unverified_context

OUTPUT_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_api_history.csv"

# Seasons to cover: 2022-23, 2023-24, 2024-25, 2025-26
# Start: Oct 1, 2022. End: Dec 31, 2025 (or current).
START_DATE = datetime(2022, 10, 1)
END_DATE = datetime(2025, 12, 31)

def get_url(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def main():
    games = []
    
    current_date = START_DATE
    while current_date <= END_DATE:
        date_str = current_date.strftime("%Y-%m-%d")
        print(f"Fetching week starting {date_str}...")
        
        # Schedule API returns a week if no end date specified? usually yes.
        # Or explicit schedule endpoint: https://api-web.nhle.com/v1/schedule/2023-10-01
        
        data = get_url(f"https://api-web.nhle.com/v1/schedule/{date_str}")
        
        if data and 'gameWeek' in data:
            for day in data['gameWeek']:
                game_date = day['date']
                for game in day['games']:
                    # Extract fields
                    game_id = game['id']
                    game_type = game['gameType'] # 2 = Regular Season, 3 = Playoffs
                    
                    if game_type != 2:
                        continue
                        
                    home_team = game['homeTeam']['abbrev']
                    away_team = game['awayTeam']['abbrev']
                    
                    # Result
                    # gameOutcome usually has 'lastPeriodType' (REG, OT, SO)
                    # Score is in homeTeam.score, awayTeam.score
                    # These might only exist for completed games (gameState="OFF" or "FINAL")
                    
                    if game['gameState'] not in ['OFF', 'FINAL', 'FUT']: # FUT means future
                        pass
                    
                    # For completed games
                    if 'score' in game['homeTeam']:
                        home_score = game['homeTeam']['score']
                        away_score = game['awayTeam']['score']
                        
                        outcome_type = game.get('gameOutcome', {}).get('lastPeriodType', 'REG')
                        
                        # Determine winner
                        winner = "TIE"
                        if home_score > away_score:
                            winner = "HOME"
                        elif away_score > home_score:
                            winner = "AWAY"
                            
                        games.append({
                            'game_id': game_id,
                            'date': game_date,
                            'season': game['season'],
                            'home_team': home_team,
                            'away_team': away_team,
                            'home_score': home_score,
                            'away_score': away_score,
                            'outcome_type': outcome_type,
                            'winner': winner
                        })
                        
        # Advance 1 week
        # The API returns exactly 1 week usually.
        # Sometimes it returns "current week" if you ask for a date?
        # Let's verify nextStartDate vs current.
        # Usually it's safe to jump 7 days.
        current_date += timedelta(days=7)
        
    # Save
    keys = ['game_id', 'date', 'season', 'home_team', 'away_team', 'home_score', 'away_score', 'outcome_type', 'winner']
    with open(OUTPUT_CSV, 'w') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(games)
        
    print(f"Saved {len(games)} games to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
