import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, accuracy_score, brier_score_loss
import pickle
import json

def prepare_features(df):
    # Sort by date
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # We need to calculate rolling stats *before* the game occurred.
    # To do this efficiently, we can iterate or use shift().
    
    # Let's reuse the logic from team_ratings but apply it row-by-row for the dataset
    # This is computationally expensive but accurate.
    
    # Alternatively, we can compute rolling means for the whole dataframe and shift by 1.
    
    # 1. Calculate Rolling xGF/xGA per Team
    df_features = df.copy()
    
    # We need to handle Home and Away rows separately to get team stats, then merge.
    # Actually, the gamestats file has 'team' and 'opponent' columns.
    # But rolling averages need to be per team.
    
    teams = df['team'].unique()
    team_stats = []
    
    print("Calculating rolling features...")
    
    for team in teams:
        t_games = df[df['team'] == team].sort_values('game_date')
        
        # Rolling xGF (Offense)
        t_games['rolling_xgf'] = t_games['xG_for'].rolling(window=10, min_periods=1).mean().shift(1)
        t_games['season_xgf'] = t_games['xG_for'].expanding().mean().shift(1)
        
        # Rolling xGA (Defense)
        t_games['rolling_xga'] = t_games['xG_against'].rolling(window=10, min_periods=1).mean().shift(1)
        t_games['season_xga'] = t_games['xG_against'].expanding().mean().shift(1)
        
        # Rest Days (Days since last game)
        t_games['last_game_date'] = t_games['game_date'].shift(1)
        t_games['rest_days'] = (t_games['game_date'] - t_games['last_game_date']).dt.days
        t_games['rest_days'] = t_games['rest_days'].fillna(3) # Default to 3 days rest for first game
        t_games['rest_days'] = t_games['rest_days'].clip(upper=5) # Cap at 5
        
        team_stats.append(t_games)
        
    df_rolling = pd.concat(team_stats).sort_values('game_date')
    
    # Now we have rolling stats for the 'team'. We need 'opponent' stats too.
    # The easiest way is to join df_rolling with itself on (game_id, team=opponent)
    # But gamestats has one row per team per game.
    # So for Game X, we have Row A (Team A vs B) and Row B (Team B vs A).
    
    # We want to train on single game instances (e.g. Home Team perspective).
    df_home = df_rolling[df_rolling['home_away'] == 'Home'].copy()
    df_away = df_rolling[df_rolling['home_away'] == 'Away'].copy()
    
    # Merge Away stats into Home rows
    # We match on game_id
    df_model = pd.merge(
        df_home, 
        df_away[['game_id', 'rolling_xgf', 'season_xgf', 'rolling_xga', 'season_xga', 'rest_days', 'starting_goalie']], 
        on='game_id', 
        suffixes=('_home', '_away')
    )
    
    # Features
    # 1. Net Rating Diff: (Home Off - Away Def) + (Home Def - Away Off)
    # Actually, let's just feed raw ratings and let the model figure it out.
    
    # Fill NA (first games)
    df_model = df_model.fillna(df_model.mean(numeric_only=True))
    
    # Goalie GSAx
    # We need to calculate GSAx history.
    # This is harder to do with simple rolling shifts because goalies change.
    # For now, we'll skip complex rolling GSAx and rely on Team Stats + Rest + Home Ice.
    # (Adding GSAx properly requires a separate goalie-game table).
    
    # Target
    # Historical data might not have 'result' column, so we derive it from goals.
    # Win = 1 if goals_for > goals_ag else 0
    df_model['target'] = (df_model['goals_for'] > df_model['goals_ag']).astype(int)
    
    return df_model

def train_model():
    print("Loading data...")
    # Load Historical + Current
    df_hist = pd.read_csv('nhl_historical_gamestats.csv')
    df_curr = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    
    # Combine
    df = pd.concat([df_hist, df_curr])
    
    # Prepare
    data = prepare_features(df)
    
    # Features to use
    features = [
        'rolling_xgf_home', 'season_xgf_home',
        'rolling_xga_home', 'season_xga_home',
        'rolling_xgf_away', 'season_xgf_away',
        'rolling_xga_away', 'season_xga_away',
        'rest_days_home', 'rest_days_away'
    ]
    
    X = data[features]
    y = data['target']
    
    # Split (Time-based split is better, but random is okay for general validation if we have multiple seasons)
    # Let's use last 20% as test
    split_idx = int(len(data) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    print(f"Training on {len(X_train)} games, Testing on {len(X_test)} games...")
    
    # Model: Logistic Regression (Good for probability calibration)
    model = LogisticRegression(max_iter=1000)
    model.fit(X_train, y_train)
    
    # Evaluate
    probs = model.predict_proba(X_test)[:, 1]
    preds = model.predict(X_test)
    
    acc = accuracy_score(y_test, preds)
    ll = log_loss(y_test, probs)
    bs = brier_score_loss(y_test, probs)
    
    print("\n--- Model Results ---")
    print(f"Accuracy: {acc:.2%}")
    print(f"Log Loss: {ll:.4f}")
    print(f"Brier Score: {bs:.4f}")
    
    # Debug Probabilities
    print("\nProbability Distribution:")
    print(pd.Series(probs).describe())
    
    # Check calibration
    # Bin probabilities and check actual win rate
    df_res = pd.DataFrame({'prob': probs, 'actual': y_test.values})
    df_res['bin'] = pd.cut(df_res['prob'], bins=10)
    calibration = df_res.groupby('bin')['actual'].mean()
    print("\nCalibration (Predicted vs Actual Win %):")
    print(calibration)
    
    # Save
    with open('game_outcome_model.pkl', 'wb') as f:
        pickle.dump(model, f)
    print("Saved game_outcome_model.pkl")
    
    # Save feature columns for prediction
    with open('model_features.json', 'w') as f:
        json.dump(features, f)

if __name__ == "__main__":
    train_model()
