import json

odds_data = json.load(open("odds.json"))
games = json.load(open("upcoming_games.json"))

for game in games:
    home_team = game['homeTeam']
    away_team = game['awayTeam']
    
    # Use the explicit gameDate we saved, or fallback to parsing if missing
    game_date = game.get('gameDate')
    if not game_date:
        game_date = game.get('startTimeUTC', '')[:10]
    
    if not game_date:
        game_date = game.get('startTimeUTC', '')[:10]
    
    matchup_id = f"{game_date}:{away_team}@{home_team}"
    print(f"Matchup: {matchup_id}")
    game_odds = odds_data.get(matchup_id, {})
    h_odds = game_odds.get(home_team)
    a_odds = game_odds.get(away_team)
    print(f"  h_odds={h_odds}, a_odds={a_odds}")
    
