import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import json

def analyze_drivers():
    print("Loading historical data...")
    # Load Historical + Current Data
    try:
        df_hist = pd.read_csv('nhl_historical_gamestats.csv')
        df_curr = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
        df = pd.concat([df_hist, df_curr], ignore_index=True)
    except FileNotFoundError:
        print("Error: Could not load gamestats CSVs.")
        return

    print(f"Total Games Analyzed: {len(df)}")

    # FEATURE ENGINEERING
    # We want to predict 'goals_for' based on specific drivers.
    
    # 1. Base Strength (5v5 xG)
    # If 5v5 xG is missing, fall back to total xG (but total includes PP, so we must be careful).
    # Ideally, we separate 5v5 from Special Teams.
    # The dataset has `xG_for_5v5`. Let's use that as the baseline.
    # Checks:
    if 'xG_for_5v5' not in df.columns:
        print("Warning: xG_for_5v5 not found. Using total xG_for as baseline (less accurate).")
        df['base_xg'] = df['xG_for']
    else:
        df['base_xg'] = df['xG_for_5v5'].fillna(df['xG_for'] * 0.8) # Fallback if specific 5v5 is null

    # 2. Special Teams Opportunities
    # `pp_opportunities` is the count of PPs FOR the team.
    # `pk_opportunities` is the count of PPs AGAINST the team (PKs).
    # We want to know the value of 1 PP Opportunity.
    
    # 3. Rest / Sequence
    # `rest_days` (Days since last game).
    # We need to calculate this since it might not be in the raw CSV for every row (it was calculated in train_model dynamically).
    # Let's recalculate it quickly.
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values(['team', 'game_date'])
    df['last_game_date'] = df.groupby('team')['game_date'].shift(1)
    df['days_rest'] = (df['game_date'] - df['last_game_date']).dt.days
    df['days_rest'] = df['days_rest'].fillna(3) # Default
    
    # B2B Flag (0 rest days means playing today and yesterday? No, 1 day diff means B2B. 0 shouldn't happen unless double header).
    # If game is Nov 2, last was Nov 1. Diff is 1 day.
    df['is_b2b'] = (df['days_rest'] == 1).astype(int)
    
    # 3 in 4 Logic
    # 3 games in 4 nights means: Game 3 (Today) - Game 1 (2 games ago) <= 3 days gap?
    # Day 1: Game 1
    # Day 2: Game 2
    # Day 3: Rest
    # Day 4: Game 3 (Today) -> 4 days span.
    # So Date(Today) - Date(Game_Minus_2) <= 3 days? Or 4 days inclusive?
    # If using .dt.days:
    # Nov 4 - Nov 1 = 3 days. That is 4 days inclusive (1, 2, 3, 4).
    # So if diff <= 3, it is 3-in-4.
    
    df['prev_2_game_date'] = df.groupby('team')['game_date'].shift(2)
    df['days_since_2_games_ago'] = (df['game_date'] - df['prev_2_game_date']).dt.days
    df['is_3in4'] = (df['days_since_2_games_ago'] <= 3).astype(int)
    
    # Also define "Tired" as B2B OR 3in4? 
    # Let's keep them separate to see coefficients.
    
    # 3. Rest
    # Let's use `is_rested` (3+ days) as before, but also `is_3in4`
    df['is_rested'] = (df['days_rest'] >= 3).astype(int)

    # 4. Home Ice
    # `home_away` column.
    df['is_home'] = (df['home_away'] == 'Home').astype(int)

    df['is_home'] = (df['home_away'] == 'Home').astype(int)
    
    # --- GAS CALCULATIONS REMOVED (Validation Failed) ---
    
    # TARGET
    # Filter out Empty Net Goals to avoid skewing "true" offensive generation
    # If stats are missing, assume 0.
    df['en_for'] = df.get('emptynet_goalsfor', 0).fillna(0)
    df['en_ag'] = df.get('emptynet_goalsagainst', 0).fillna(0)
    
    # We predict roughly "Goalie-Defended Goals"
    y = df['goals_for'] - df['en_for']

    # FEATURES
    # We want to find the coefficient for:
    # - Base xG (Should be close to 1.0)
    # - PP Opp (Value of one PP)
    # - PK Opp (Value of being on PK - usually negative for GF? No, PK opps don't score goals usually. Shorthanded?)
    #   Wait, 'goals_for' includes PP and SH goals.
    #   A PK opportunity reduces your 5v5 time, so it might have a negative coeff for GF? 
    #   Or we can ignore PK for GF and only look at it for GA.
    #   Let's stick to Offensive Drivers for now.
    
    # - B2B (Fatigue penalty)
    # - 3in4 (Fatigue penalty - severe)
    # - Home (Home advantage)
    # - GAS Diff (New Validation)
    
    # features = ['base_xg', 'pp_opportunities', 'is_b2b', 'is_3in4', 'gas_diff']
    # Removed gas_diff because it killed Home Ice (collinearity) and had low coeff (0.001).
    # Reverting to proven features.
    
    features = ['base_xg', 'pp_opportunities', 'is_b2b', 'is_3in4', 'is_home']
    
    # Clean Data
    df_clean = df[features + ['goals_for']].dropna()
    
    X = df_clean[features]
    y = df_clean['goals_for']
    
    model = LinearRegression()
    model.fit(X, y)
    
    obs = len(df_clean)
    r2 = model.score(X, y)
    
    print(f"\n--- Regression Results (n={obs}, R2={r2:.4f}) ---")
    print(f"Intercept: {model.intercept_:.4f}")
    
    coeffs = dict(zip(features, model.coef_))
    for k, v in coeffs.items():
        print(f"  {k}: {v:.4f}")
        
    # Analysis
    pp_val = coeffs['pp_opportunities']
    b2b_val = coeffs['is_b2b']
    home_val = coeffs['is_home']
    
    print("\n--- Interpretation ---")
    print(f"1. Base 5v5 xG is worth {coeffs['base_xg']:.2f} actual goals (Calibrator).")
    print(f"2. A Power Play Opportunity is worth {pp_val:.2f} goals (League Avg).")
    print(f"3. Playing a Back-to-Back costs a team {b2b_val:.2f} goals.")
    print(f"4. Playing 3-in-4 Nights costs a team {coeffs['is_3in4']:.2f} goals.")
    print(f"5. Home Ice is worth {coeffs['is_home']:.2f} goals.")
    
    # Define Goals Against Drivers?
    # We could flip it: GA drivers.
    # GA ~ xGA_5v5 + PK_opportunities (opponent PP) + B2B + Home
    # Let's do that too for completeness.
    
    print("\n--- Defense (Goals Against) Analysis ---")
    df['base_xga'] = df['xG_against_5v5'].fillna(df['xG_against'] * 0.8)
    
    # Features for GA
    # PK Opps (Times I grew short) -> Increases GA
    # Features for GA
    # PK Opps (Times I grew short) -> Increases GA
    features_ga = ['base_xga', 'pk_opportunities', 'is_b2b', 'is_3in4', 'is_home']
    
    df_clean_ga = df[features_ga + ['goals_ag', 'en_ag']].dropna()
    X_ga = df_clean_ga[features_ga]
    y_ga = df_clean_ga['goals_ag'] - df_clean_ga['en_ag']
    
    model_ga = LinearRegression()
    model_ga.fit(X_ga, y_ga)
    
    coeffs_ga = dict(zip(features_ga, model_ga.coef_))
    for k, v in coeffs_ga.items():
        print(f"  {k}: {v:.4f}")
        
    pk_val = coeffs_ga['pk_opportunities'] # Cost of taking a penalty
    
    print(f"5. Taking a Penalty (PK) costs {pk_val:.2f} goals against.")
    
    # SAVE to JSON
    output = {
        "xg_5v5_coeff": coeffs['base_xg'],
        "pp_opp_val": pp_val,
        "pk_opp_cost": pk_val,
        "b2b_cost_gf": b2b_val,
        "b2b_cost_ga": coeffs_ga['is_b2b'],
        "3in4_cost_gf": coeffs['is_3in4'],
        "3in4_cost_ga": coeffs_ga['is_3in4'],
        "home_ice_gf": coeffs['is_home'],
        "home_ice_ga": coeffs_ga['is_home']
    }
    
    # Sanitize 3-in-4: If positive (more goals), treat as 0 penalty?
    # Our analysis showed +0.12 GF and +0.14 GA. High event??
    # Ideally we only penalize. 
    # Let's trust B2B (-0.26) and maybe cap 3in4 at 0 or small negative if logic dictates.
    # For now, saving raw.
    
    with open('scoring_coefficients.json', 'w') as f:
        json.dump(output, f, indent=2)
    print("\nSaved coeffcients to scoring_coefficients.json")

if __name__ == "__main__":
    analyze_drivers()
