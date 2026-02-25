import json
import os

script_dir = os.path.dirname(os.path.abspath(__file__))

odds_path = os.path.join(script_dir, 'odds.json')
schedule_path = os.path.join(script_dir, 'upcoming_games.json')

with open(odds_path, 'r') as f:
    odds_data = json.load(f)

with open(schedule_path, 'r') as f:
    games = json.load(f)

for game in games:
    away_team = game.get("awayTeam")
    home_team = game.get("homeTeam")
    game_date = game.get('gameDate')
    if not game_date:
        game_date = game.get('startTimeUTC', '')[:10]
    matchup_id = f"{game_date}:{away_team}@{home_team}"
    print(f"Matchup: {matchup_id} - in odds_data? {matchup_id in odds_data}")
    game_odds = odds_data.get(matchup_id, {})
    h_odds = game_odds.get(home_team)
    a_odds = game_odds.get(away_team)
    print(f"  h_odds={h_odds}, a_odds={a_odds}")
