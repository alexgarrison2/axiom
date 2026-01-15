
import pandas as pd
import os

def backfill_special_teams():
    print("--- Backfilling Special Teams Data from H-Ref ---")
    
    # Paths
    # If running from pipeline dir, these need to be relative to it
    # We'll assume we are in pipeline dir if calling from refresh_pipeline
    gamestats_path = "nhl_season_2025_2026_gamestats.csv"
    href_path = "href_stats.csv"
    
    # If running from Root, we need to adjust?
    # refresh_pipeline runs IN pipeline dir (cd pipeline && python...)
    # So "nhl_season..." and "href_stats.csv" (if in root) might need adjustment.
    
    # Check if href_stats is in CWD or Parent
    if not os.path.exists(href_path):
        if os.path.exists(f"../{href_path}"):
            href_path = f"../{href_path}"
    
    if not os.path.exists(gamestats_path):
        # Try full path if needed, but for now assume CWD
        print(f"Error: {gamestats_path} not found in {os.getcwd()}")
        return

        
    # Load Data
    df_game = pd.read_csv(gamestats_path)
    df_href = pd.read_csv(href_path)
    
    print(f"Loaded {len(df_game)} gamestats rows.")
    print(f"Loaded {len(df_href)} H-Ref rows.")
    
    # Normalize Dates
    df_game['date_norm'] = pd.to_datetime(df_game['game_date']).dt.strftime('%Y-%m-%d')
    # H-Ref dates are usually YYYY-MM-DD strings already, but safer to convert
    df_href['date_norm'] = pd.to_datetime(df_href['date']).dt.strftime('%Y-%m-%d')
    
    # Load Team Mapping (Name -> Tricode) to match gamestats 'team' col to href 'team' col
    # gamestats uses "dallas stars" or "stars" or "Stars"? It uses "Stars" (Common Name)
    # href uses "DAL"
    
    # We need a robust map. Let's try to load nhl_teams.csv if possible, or build a quick one
    # Quick Map (Common Name -> Tricode)
    team_map = {
        "Ducks": "ANA", "Bruins": "BOS", "Sabres": "BUF", "Hurricanes": "CAR", "Blue Jackets": "CBJ",
        "Flames": "CGY", "Blackhawks": "CHI", "Avalanche": "COL", "Stars": "DAL", "Red Wings": "DET",
        "Oilers": "EDM", "Panthers": "FLA", "Kings": "LAK", "Wild": "MIN", "Canadiens": "MTL",
        "Devils": "NJD", "Predators": "NSH", "Islanders": "NYI", "Rangers": "NYR", "Senators": "OTT",
        "Flyers": "PHI", "Penguins": "PIT", "Kraken": "SEA", "Sharks": "SJS", "Blues": "STL",
        "Lightning": "TBL", "Maple Leafs": "TOR", "Mammoth": "UTA", "Canucks": "VAN", "Golden Knights": "VEG", # HRef uses VEG? Yes, check fetch_href_stats.
        "Jets": "WPG", "Capitals": "WSH"
    }
    
    # Verify H-Ref codes. fetch_href_stats says: VGK->VEG, UTA->UTA
    # So Golden Knights -> VEG is correct for this map if HRef uses VEG.
    
    # Create a lookup dictionary from H-Ref
    # Key: (date_norm, tricode) -> (pp_goals, pp_opps, opp_pp_goals, opp_pp_opps)
    href_lookup = {}
    for _, row in df_href.iterrows():
        key = (row['date_norm'], row['team'])
        href_lookup[key] = {
            'pp_goals': row['pp_goals'],
            'pp_opportunities': row['pp_opportunities'],
            'pp_goals_against': row['opp_pp_goals'], # Href calls it opp_pp_goals
            'pk_opportunities': row['opp_pp_opportunities']
        }
        
    updated_count = 0
    
    def update_row(row):
        nonlocal updated_count
        team_common = row['team']
        tricode = team_map.get(team_common)
        
        if not tricode:
            print(f"Warning: No tricode map for {team_common}")
            return row
            
        key = (row['date_norm'], tricode)
        if key in href_lookup:
            data = href_lookup[key]
            
            # Check for changes
            changes = False
            # Conversions
            new_ppg = int(data['pp_goals'])
            new_ppo = int(data['pp_opportunities'])
            new_ppga = int(data['pp_goals_against'])
            new_pko = int(data['pk_opportunities'])
            
            if (row['pp_goals'] != new_ppg or 
                row['pp_opportunities'] != new_ppo or
                row['pp_goals_against'] != new_ppga or
                row['pk_opportunities'] != new_pko):
                
                row['pp_goals'] = new_ppg
                row['pp_opportunities'] = new_ppo
                row['pp_goals_against'] = new_ppga
                row['pk_opportunities'] = new_pko
                updated_count += 1
                
        return row

    # Apply updates
    df_game = df_game.apply(update_row, axis=1)
    
    # Drop helper
    df_game = df_game.drop(columns=['date_norm'])
    
    print(f"Updated {updated_count} rows with H-Ref data.")
    
    # Save
    df_game.to_csv(gamestats_path, index=False)
    print(f"Saved to {gamestats_path}")
    
    # Sync to public
    df_game.to_csv('../public/data/gamestats.csv', index=False)
    print("Synced to ../public/data/gamestats.csv")

if __name__ == "__main__":
    backfill_special_teams()
