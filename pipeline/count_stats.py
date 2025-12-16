
import csv

FILENAME = "nhl_season_2025_2026_gamestats.csv"
TEAM = "Avalanche"

total_opps = 0
games = 0

with open(FILENAME, 'r') as f:
    reader = csv.DictReader(f)
    team_stats = {}
    for row in reader:
        team_name = row['team']
        if team_name not in team_stats:
            team_stats[team_name] = {'games': 0, 'pp_opps': 0}

        team_stats[team_name]['games'] += 1
        opps = int(row['pp_opportunities'])
        team_stats[team_name]['pp_opps'] += opps
        # print(f"Game {row['game_id']}: {opps}")

print(f"{'Team':<20} {'GP':<5} {'PP Opps':<10}")
print("-" * 35)
for team, stats in sorted(team_stats.items()):
    print(f"{team:<20} {stats['games']:<5} {stats['pp_opps']:<10}")
