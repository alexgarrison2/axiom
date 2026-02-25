import json

odds_data = json.load(open("odds.json"))
games = json.load(open("upcoming_games.json"))

for game in games:
    away = game.get("awayTeam")
    home = game.get("homeTeam")
    game_date = game.get('gameDate')
    if not game_date:
        game_date = game.get('startTimeUTC', '')[:10]
    matchup_id = f"{game_date}:{away}@{home}"
    print(f"Checking {matchup_id} - in odds_data? {matchup_id in odds_data}")
    game_odds = odds_data.get(matchup_id, {})
    print(f"  h_odds: {game_odds.get(home)}")
