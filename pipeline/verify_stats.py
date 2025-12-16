
import csv

FILENAME = "nhl_season_2025_2026_gamestats.csv"
TARGET_GAME = "2025020240"
TARGET_TEAM = "Avalanche"

headers = [
    'game_id', 'game_date', 'team', 'opponent', 'side', 'result', 'team_game_number', 'opp_game_number', 
    'xg_for', 'xg_against', 'xg_for_5v5', 'xg_against_5v5', 
    'goalie', 'opp_goalie', 'goalie_status', 'opp_goalie_status', 
    'goals_1', 'goals_2', 'goals_3', 'goals_4', 'goals_total', 
    'sog_1', 'sog_2', 'sog_3', 'sog_4', 'sog_total', 
    'attempts_1', 'attempts_2', 'attempts_3', 'attempts_4', 'attempts_total', 
    'hits_1', 'hits_2', 'hits_3', 'hits_4', 'hits_total', 
    'pp_goals', 'pp_opps', 'pp_time', 'pk_opps', 'pk_time'
]

with open(FILENAME, 'r') as f:
    reader = csv.reader(f)
    # Skip actual header if it exists (it does)
    next(reader) 
    
    for row in reader:
        if row[0] == TARGET_GAME and row[2] == TARGET_TEAM:
            print(f"Found {TARGET_TEAM} Game {TARGET_GAME}")
            # Map headers
            start_idx = 0
            # Manually map likely indices if header length mismatch
            # But let's verify length
            # The headers list above is approximate from memory/scraper.
            # Let's print relevant indices.
            
            # xG 5v5 is index 10
            print(f"xG 5v5: {row[10]}")
            
            # PP Stats are after hits.
            # Hits total is index 35.
            # So PP Goals = 36
            # PP Opps = 37
            # PP Time = 38
            
            # Let's verify by printing a range
            print(f"Values around index 35-40: {row[35:41]}")
            
            # Also check totals
            print(f"Goals Total (simulated idx 20): {row[20]}")
