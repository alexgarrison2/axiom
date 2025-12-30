import pandas as pd

def debug():
    # Load Shots
    df_shots = pd.read_csv("pipeline/nhl_season_2025_2026_shots.csv")
    print(f"Loaded {len(df_shots)} shots.")
    
    # Filter Game 1
    g1 = df_shots[df_shots['game_id'] == 2025020001]
    print(f"Game 1 Shots: {len(g1)}")
    print(f"Game 1 Team IDs: {g1['team_id'].unique()}")
    
    # Load Teams
    teams_df = pd.read_csv("pipeline/nhl_teams.csv")
    print(f"Loaded {len(teams_df)} teams.")
    
    id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))
    
    # Map
    ids = g1['team_id'].unique()
    for tid in ids:
        name = id_to_name.get(tid, "NOT FOUND")
        print(f"ID {tid} -> {name}")
        
if __name__ == "__main__":
    debug()
