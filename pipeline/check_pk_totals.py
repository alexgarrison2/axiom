
import pandas as pd
import os

def check_pk_totals():
    print("--- Checking PK Stats (All Teams) ---")
    
    # Load Data
    gamestats_path = "public/data/gamestats.csv"
    href_path = "href_stats.csv"
    
    if not os.path.exists(gamestats_path):
        # Fallback for running in pipeline dir
        gamestats_path = "../public/data/gamestats.csv"
    if not os.path.exists(href_path):
        href_path = "../href_stats.csv"
        
    df_game = pd.read_csv(gamestats_path)
    df_href = pd.read_csv(href_path)
    
    # Map for H-Ref aggregation
    # Standardize H-Ref teams to our names if needed, or vice-versa.
    # We will iterate our teams (Common Name) and map to Tricode for H-Ref lookup.
    
    team_map = {
        "Ducks": "ANA", "Bruins": "BOS", "Sabres": "BUF", "Hurricanes": "CAR", "Blue Jackets": "CBJ",
        "Flames": "CGY", "Blackhawks": "CHI", "Avalanche": "COL", "Stars": "DAL", "Red Wings": "DET",
        "Oilers": "EDM", "Panthers": "FLA", "Kings": "LAK", "Wild": "MIN", "Canadiens": "MTL",
        "Devils": "NJD", "Predators": "NSH", "Islanders": "NYI", "Rangers": "NYR", "Senators": "OTT",
        "Flyers": "PHI", "Penguins": "PIT", "Kraken": "SEA", "Sharks": "SJS", "Blues": "STL",
        "Lightning": "TBL", "Maple Leafs": "TOR", "Mammoth": "UTA", "Canucks": "VAN", "Golden Knights": "VGK",
        "Jets": "WPG", "Capitals": "WSH"
    }
    
    # Process each team
    print(f"{'Team':<20} | {'App PK%':<10} | {'H-Ref PK%':<10} | {'Diff':<6} | {'Stats (App vs HRef)'}")
    print("-" * 85)
    
    dist_teams = sorted(df_game['team'].unique())
    
    for team in dist_teams:
        # App Stats
        df_t = df_game[df_game['team'] == team]
        # PK = (PK_Opps - PPGA) / PK_Opps
        # Columns: 'pk_opportunities' (times shorthanded), 'pp_goals_against' (goals allowed)
        
        # Verify columns exist
        if 'pk_opportunities' not in df_t.columns or 'pp_goals_against' not in df_t.columns:
            print(f"Skipping {team} - columns missing")
            continue
            
        app_ts = df_t['pk_opportunities'].sum()
        app_ga = df_t['pp_goals_against'].sum()
        
        app_pk_pct = ((app_ts - app_ga) / app_ts * 100) if app_ts > 0 else 0
        
        # H-Ref Stats
        tricode = team_map.get(team)
        if not tricode:
            print(f"Skipping {team} - no map")
            continue
            
        df_h = df_href[df_href['team'] == tricode]
        # H-Ref Cols: opp_pp_opportunities (TS), opp_pp_goals (GA)
        href_ts = pd.to_numeric(df_h['opp_pp_opportunities']).sum()
        href_ga = pd.to_numeric(df_h['opp_pp_goals']).sum()
        
        href_pk_pct = ((href_ts - href_ga) / href_ts * 100) if href_ts > 0 else 0
        
        diff = app_pk_pct - href_pk_pct
        
        stats_str = f"{app_ga}/{app_ts} vs {href_ga}/{href_ts}"
        
        if True: # Print all
            print(f"{team:<20} | {app_pk_pct:>6.2f}%    | {href_pk_pct:>6.2f}%    | {diff:>5.2f}% | {stats_str}")
            
if __name__ == "__main__":
    check_pk_totals()
