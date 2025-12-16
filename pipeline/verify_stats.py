
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
    reader = csv.DictReader(f)
    found = False
    for row in reader:
        if row['game_id'] == TARGET_GAME and row['team'] == TARGET_TEAM:
            print(f"Found {TARGET_TEAM} Game {TARGET_GAME}")
            print(f"Score: {row['goals_for']} - {row['goals_ag']}")
            print(f"PP Goals: {row['pp_goals']}")
            print(f"PP Opps: {row['pp_opportunities']}")
            print(f"PP Time: {row['pp_time']}")
            print(f"PK Opps: {row['pk_opportunities']}")
            print(f"PK Time: {row['pk_time']}")
            print(f"xG 5v5: {row['xG_for_5v5']}")
            print(f"Hits For: {row['hits_for']}")
            found = True
            break
            
    if not found:
        print("Game not found.")
