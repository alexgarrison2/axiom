import urllib.request
import json
import datetime
import ssl

import fetch_dailyfaceoff
import pandas as pd
import pytz

def get_team_goalies(gamestats_file="nhl_season_2025_2026_gamestats.csv"):
    """
    Builds a map of Team Name -> set of Goalies who primarily play for them.
    A goalie is considered 'belonging' to a team if they have played 
    more games for that team than any other team in the dataset.
    """
    try:
        df = pd.read_csv(gamestats_file)
        if df.empty:
            return {}
            
        # Count games per goalie per team
        # Column 13 is starting_goalie, Column 3 is team
        counts = df.groupby(['starting_goalie', 'team']).size().reset_index(name='count')
        
        # For each goalie, find their primary team
        primary_teams = counts.sort_values('count', ascending=False).drop_duplicates('starting_goalie')
        
        team_map = {}
        for _, row in primary_teams.iterrows():
            t = row['team']
            g = row['starting_goalie']
            if t not in team_map:
                team_map[t] = set()
            team_map[t].add(g)
            
        return team_map
    except Exception as e:
        print(f"Warning: Could not build primary team-goalie map: {e}")
        return {}

def fetch_schedule():
    # Fetch Daily Faceoff Data first
    print("Fetching confirmed goalies from Daily Faceoff...")
    dfo_goalies = fetch_dailyfaceoff.fetch_dailyfaceoff_goalies()
    
    # Fetch Today and Tomorrow (US/Central Time)
    dates_to_fetch = []
    central_tz = pytz.timezone('US/Central')
    today = datetime.datetime.now(central_tz).date()
    
    dates_to_fetch.append(today.strftime("%Y-%m-%d"))
    tomorrow = today + datetime.timedelta(days=1)
    dates_to_fetch.append(tomorrow.strftime("%Y-%m-%d"))
    
    all_games = []
    
    # Load Team Goalie Mapping for validation
    team_goalie_map = get_team_goalies()
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    for target_date in dates_to_fetch:
        print(f"Fetching schedule for {target_date}...")
        url = f"https://api-web.nhle.com/v1/schedule/{target_date}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        try:
            with urllib.request.urlopen(req, context=ctx) as response:
                data = json.load(response)
                
            # The API returns a 'gameWeek' list. We need to find the specific date.
            for day in data.get('gameWeek', []):
                if day['date'] == target_date:
                    for game in day.get('games', []):
                        home_team_common = game['homeTeam']['commonName']['default']
                        away_team_common = game['awayTeam']['commonName']['default']
                        
                        # Match with DFO data
                        # DFO keys are full names (e.g. "New Jersey Devils")
                        # API gives common names (e.g. "Devils")
                        
                        # Goalie Logic
                        # 1. Check DailyFaceoff (Probable/Confirmed)
                        # 2. Check NHL API (Confirmed)
                        # 3. Default to "Unconfirmed" (NOT Likely)
                        
                        home_goalie = None
                        away_goalie = None
                        home_status = "Unconfirmed"
                        away_status = "Unconfirmed"
                        
                        # Check DFO first
                        h_dfo_info = None
                        for key, info in dfo_goalies.items():
                            if target_date not in key:
                                continue
                                
                            dfo_team_name = key.replace(f"_{target_date}", "")
                            if home_team_common in dfo_team_name:
                                # VALIDATION: Does this goalie belong to the team?
                                g_name = info.get('goalie')
                                team_goalies = team_goalie_map.get(home_team_common, set())
                                # Also check common name fallback
                                if home_team_common not in team_goalie_map:
                                    # Try to find team in map by substring
                                    for t_name, gs in team_goalie_map.items():
                                        if home_team_common in t_name:
                                            team_goalies = gs
                                            break
                                
                                if g_name and g_name not in team_goalies and team_goalies:
                                    print(f"  [VALIDATION FAILED] {g_name} reported for {home_team_common}, but has no history there. Rejecting.")
                                    continue

                                h_dfo_info = info
                                print(f"Matched Home: {home_team_common} -> {dfo_team_name} (Status: {info.get('status')})")
                                break
                        
                        a_dfo_info = None
                        for key, info in dfo_goalies.items():
                            if target_date not in key:
                                continue

                            dfo_team_name = key.replace(f"_{target_date}", "")
                            if away_team_common in dfo_team_name:
                                # VALIDATION
                                g_name = info.get('goalie')
                                team_goalies = team_goalie_map.get(away_team_common, set())
                                if away_team_common not in team_goalie_map:
                                    for t_name, gs in team_goalie_map.items():
                                        if away_team_common in t_name:
                                            team_goalies = gs
                                            break

                                if g_name and g_name not in team_goalies and team_goalies:
                                    print(f"  [VALIDATION FAILED] {g_name} reported for {away_team_common}, but has no history there. Rejecting.")
                                    continue

                                a_dfo_info = info
                                print(f"Matched Away: {away_team_common} -> {dfo_team_name} (Status: {info.get('status')})")
                                break
                        
                        if h_dfo_info:
                            home_goalie = h_dfo_info['goalie']
                            status_raw = h_dfo_info['status'].lower()
                            if status_raw == "confirmed":
                                home_status = "Confirmed"
                            elif "probable" in status_raw or "likely" in status_raw:
                                home_status = "Likely"
                            else:
                                home_status = "Unconfirmed"
                                
                        if a_dfo_info:
                            away_goalie = a_dfo_info['goalie']
                            status_raw = a_dfo_info['status'].lower()
                            if status_raw == "confirmed":
                                away_status = "Confirmed"
                            elif "probable" in status_raw or "likely" in status_raw:
                                away_status = "Likely"
                            else:
                                away_status = "Unconfirmed"
                        
                        game_info = {
                            'id': game['id'],
                            'gameDate': target_date, # Explicitly save the date we fetched for
                            'startTimeUTC': game['startTimeUTC'],
                            'homeTeam': home_team_common,
                            'awayTeam': away_team_common,
                            'homeTeamAbbrev': game['homeTeam']['abbrev'],
                            'awayTeamAbbrev': game['awayTeam']['abbrev'],
                            'homeGoalieConfirmed': home_goalie,
                            'homeGoalieStatus': home_status,
                            'awayGoalieConfirmed': away_goalie,
                            'awayGoalieStatus': away_status
                        }
                        all_games.append(game_info)
                    break
        except Exception as e:
            print(f"Error fetching schedule for {target_date}: {e}")
            
    print(f"Found {len(all_games)} games total.")
    
    with open('upcoming_games.json', 'w') as f:
        json.dump(all_games, f, indent=4)
    print("Saved upcoming_games.json")
    return all_games

if __name__ == "__main__":
    fetch_schedule()
