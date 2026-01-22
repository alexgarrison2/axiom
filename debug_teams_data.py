
import pandas as pd
import csv

def debug_data():
    try:
        # Load teams
        teams_df = pd.read_csv('public/data/nhl_teams.csv')
        print("Teams loaded. Columns:", teams_df.columns.tolist())
        
        # Load gamestats
        gamestats_df = pd.read_csv('public/data/gamestats.csv')
        print("Gamestats loaded. Columns:", gamestats_df.columns.tolist())
        
        # Check unique teams in gamestats
        unique_gamestats_teams = sorted(gamestats_df['team'].unique())
        print(f"\nUnique teams in gamestats ({len(unique_gamestats_teams)}):")
        print(unique_gamestats_teams)
        
        # Check unique common names in teams
        unique_team_names = sorted(teams_df['Common Name'].unique())
        print(f"\nUnique Common Names in nhl_teams ({len(unique_team_names)}):")
        print(unique_team_names)
        
        # Find mismatches
        print("\nMismatches (In Teams but not in Gamestats):")
        for t in unique_team_names:
            if t not in unique_gamestats_teams:
                print(f" - '{t}'")
                
        print("\nMismatches (In Gamestats but not in Teams):")
        for t in unique_gamestats_teams:
            if t not in unique_team_names:
                print(f" - '{t}'")

        # Specific check for whitespace
        print("\nWhitespace check:")
        for t in unique_team_names:
            if t != t.strip():
                print(f"WARNING: Team '{t}' has whitespace in nhl_teams.csv")
        
        for t in unique_gamestats_teams:
            if t != t.strip():
                print(f"WARNING: Team '{t}' has whitespace in gamestats.csv")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_data()
