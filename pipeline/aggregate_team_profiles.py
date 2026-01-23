
import pandas as pd
import json

INPUT_FILE = "data/training_data_advanced_shots.csv"
OUTPUT_FILE = "public/data/team_edge_profiles.json"
OUTPUT_CSV = "data/team_edge_profiles.csv"

def aggregate():
    print(f"Loading {INPUT_FILE}...")
    try:
        df = pd.read_csv(INPUT_FILE)
    except FileNotFoundError:
        print("File not found. Please run feature_engine.py first.")
        return

    # Basic Cleaning
    # team_id should be float or int? Handle NaNs
    df = df.dropna(subset=['team_id'])
    df['team_id'] = df['team_id'].astype(int)
    
    print(f"Aggregating stats for {df['team_id'].nunique()} teams...")
    
    # Aggregations
    # We want "Per Game" or "Average per Shot"?
    # For prediction models, "Average per Shot" is normalized. "Per Game" is volume dependent.
    # Let's do Average Per Shot first for quality Metrics.
    
    profiles = df.groupby('team_id').agg({
        'implied_speed': 'mean',
        'royal_road': 'mean', # % of shots preceded by RR crossing
        'is_rebound': 'mean',
        'dist_to_net': 'mean',
        'angle': 'mean',
        'game_id': 'nunique' # Count games played in sample
    }).reset_index()
    
    # Renal columns
    profiles.columns = ['team_id', 'avg_speed', 'rr_rate', 'rebound_rate', 'avg_dist', 'avg_angle', 'games_sampled']
    
    # Rounding
    profiles = profiles.round(4)
    
    # Save as JSON for Frontend/Prediction
    # Convert to Dict { team_id: { ... } }
    
    result = {}
    for _, row in profiles.iterrows():
        tid = int(row['team_id'])
        result[tid] = row.to_dict()
        del result[tid]['team_id'] # No need to duplicate key
        
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(result, f, indent=2)
        
    print(f"Saved JSON to {OUTPUT_FILE}")
    
    # Save CSV for debugging
    profiles.to_csv(OUTPUT_CSV, index=False)
    print(f"Saved CSV to {OUTPUT_CSV}")

if __name__ == "__main__":
    aggregate()
