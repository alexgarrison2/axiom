
import csv

FILENAME = "nhl_season_2025_2026_gamestats.csv"
TEAM = "Avalanche"

total_opps = 0
games = 0

with open(FILENAME, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['team'] == TEAM:
            games += 1
            opps = int(row['pp_opportunities'])
            total_opps += opps
            # print(f"Game {row['game_id']}: {opps}")

print(f"Team: {TEAM}")
print(f"Games: {games}")
print(f"Total Opps: {total_opps}")
print(f"Avg: {total_opps/games if games else 0}")
