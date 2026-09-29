from season import season_file, read_season_csv
import urllib.request
import json
import datetime
import ssl

import fetch_dailyfaceoff
import pandas as pd
import pytz
import unicodedata

def normalize_name(name):
    """Normalize names by removing accents and making lowercase."""
    if not name:
        return ""
    # Normalize unicode to decomposed form and filter out non-spacing marks (accents)
    normalized = unicodedata.normalize('NFD', name)
    return "".join(c for c in normalized if unicodedata.category(c) != 'Mn').lower().strip()

def get_team_goalies(gamestats_file=season_file("gamestats")):
    """
    Builds a map of Team Name -> set of Goalies who primarily play for them.
    A goalie is considered 'belonging' to a team if they have played 
    more games for that team than any other team in the dataset.
    """
    try:
        df = read_season_csv("gamestats", gamestats_file)
        if df.empty:
            return {}
            
        # FILTER: Only consider games with actual statistics (e.g. shots_on_goal > 0)
        # to avoid being misled by simulated/empty future entries in gamestats.csv
        if 'shots_on_goal' in df.columns:
            df = df[df['shots_on_goal'] > 0]
            
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
                                h_dfo_info = info
                                print(f"Matched Home: {home_team_common} -> {dfo_team_name} (Status: {info.get('status')})")
                                
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
                                
                                if g_name:
                                    status_val = info.get('status', '').lower()
                                    if team_goalies:
                                        norm_g = normalize_name(g_name)
                                        norm_team_gs = {normalize_name(tg) for tg in team_goalies}
                                        
                                        if norm_g not in norm_team_gs:
                                            if status_val in ("confirmed", "likely", "probable"):
                                                print(f"  [VALIDATION WARNING] {g_name} ({status_val}) for {home_team_common}, but has no history there. Accepting (possible trade).")
                                            else:
                                                print(f"  [VALIDATION FAILED] {g_name} reported for {home_team_common}, but has no history there. Rejecting unconfirmed status.")
                                                continue
                                    elif status_val == "confirmed":
                                         print(f"  [VALIDATION WARNING] {g_name} confirmed for {home_team_common} (No history found). Accepting.")

                                break
                        
                        a_dfo_info = None
                        for key, info in dfo_goalies.items():
                            if target_date not in key:
                                continue

                            dfo_team_name = key.replace(f"_{target_date}", "")
                            if away_team_common in dfo_team_name:
                                a_dfo_info = info
                                print(f"Matched Away: {away_team_common} -> {dfo_team_name} (Status: {info.get('status')})")

                                # VALIDATION
                                g_name = info.get('goalie')
                                team_goalies = team_goalie_map.get(away_team_common, set())
                                if away_team_common not in team_goalie_map:
                                    for t_name, gs in team_goalie_map.items():
                                        if away_team_common in t_name:
                                            team_goalies = gs
                                            break

                                if g_name:
                                    status_val = info.get('status', '').lower()
                                    if team_goalies:
                                        norm_g = normalize_name(g_name)
                                        norm_team_gs = {normalize_name(tg) for tg in team_goalies}
                                        
                                        if norm_g not in norm_team_gs:
                                            if status_val in ("confirmed", "likely", "probable"):
                                                print(f"  [VALIDATION WARNING] {g_name} ({status_val}) for {away_team_common}, but has no history there. Accepting (possible trade).")
                                            else:
                                                print(f"  [VALIDATION FAILED] {g_name} reported for {away_team_common}, but has no history there. Rejecting unconfirmed status.")
                                                continue
                                    elif status_val == "confirmed":
                                         print(f"  [VALIDATION WARNING] {g_name} confirmed for {away_team_common} (No history found). Accepting.")

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
                        
                        # Extract US national TV network (prefer national over local)
                        tv_network = ''
                        broadcasts = game.get('tvBroadcasts', [])
                        # Priority: national US broadcasts first
                        national_us = [b['network'] for b in broadcasts if b.get('market') == 'N' and b.get('countryCode') == 'US']
                        if national_us:
                            tv_network = national_us[0]

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
                            'awayGoalieStatus': away_status,
                            'tvNetwork': tv_network,
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
