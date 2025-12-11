import json
import pandas as pd
import numpy as np
import pickle
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, log_loss, accuracy_score
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
import xgboost as xgb

# Load Data
def load_data(filepath):
    print(f"Loading data from {filepath}...")
    df = pd.read_csv(filepath)
    return df

# Preprocessing
def preprocess_data(df):
    print("Preprocessing data with Spatial Bins & Handedness...")
    
    # 1. Load Handedness Map
    try:
        with open('player_hand.json', 'r') as f:
            player_hand = json.load(f)
    except:
        print("Warning: player_hand.json not found. Assuming all Unknown.")
        player_hand = {}
        
    # 2. Filter for relevant events
    df = df[df['event_type'].isin([505, 506, 507])].copy()
    
    # 3. Map Handedness
    df['handedness'] = df['player_id'].astype(str).map(player_hand).fillna('U')
    
    # 4. Feature Engineering (Spatial Bins & Off-Wing)
    
    # --- Spatial Bins (25-Bin System) ---
    # We define a 5x5 grid based on Depth (Distance from Goal Line) and Width (Abs Y).
    # Net is at x=89.
    
    def assign_bin(row):
        # 1. Calculate Depth (Distance from Goal Line x=89)
        # We assume offensive zone data is normalized to positive x?
        # If absolute, net is at 89. Center is 0.
        # Depth = 89 - abs(x)
        # Note: Some data might have x > 89 (behind net). We handle that as Depth 0 or separate.
        
        depth_val = 89 - abs(row['x'])
        
        # Depth Zones
        # D1: Net Front / Deep (0-10ft)
        # D2: Low Slot (10-20ft)
        # D3: High Slot / Circles (20-35ft)
        # D4: Point / Top Circles (35-55ft)
        # D5: Long Range (55ft+)
        if depth_val < 10: d = "D1"
        elif depth_val < 20: d = "D2"
        elif depth_val < 35: d = "D3"
        elif depth_val < 55: d = "D4"
        else: d = "D5"
        
        # Width Zones (Abs Y)
        # Center is 0. Boards are 42.5.
        # W1: Central (0-5ft)
        # W2: Inner (5-15ft)
        # W3: Mid (15-25ft)
        # W4: Outer (25-35ft)
        # W5: Boards (35ft+)
        y_abs = abs(row['y'])
        
        if y_abs < 5: w = "W1"
        elif y_abs < 15: w = "W2"
        elif y_abs < 25: w = "W3"
        elif y_abs < 35: w = "W4"
        else: w = "W5"
        
        return f"{d}_{w}"

    df['spatial_bin'] = df.apply(assign_bin, axis=1)
    
    def get_side(row):
        if row['x'] > 0:
            return 'L' if row['y'] > 0 else 'R'
        else:
            return 'R' if row['y'] > 0 else 'L'

    df['side_ice'] = df.apply(get_side, axis=1)
    
    def is_off_wing(row):
        hand = row['handedness']
        side = row['side_ice']
        if hand == 'L': return 1 if side == 'R' else 0
        elif hand == 'R': return 1 if side == 'L' else 0
        else: return 0
            
    df['is_off_wing'] = df.apply(is_off_wing, axis=1)
    
    y = df['is_goal']
    
    # Updated Feature List (No raw distance/angle)
    feature_cols = [
        'spatial_bin', 'is_off_wing', 
        'shot_type', 'is_rebound', 'is_rush', 
        'score_differential', 'time_since_last_event'
    ]
    X = df[feature_cols]
    return X, y

# Train Logistic Regression
def train_logistic_regression(X_train, y_train):
    print("Training Logistic Regression...")
    
    numeric_features = ['score_differential', 'time_since_last_event']
    categorical_features = ['spatial_bin', 'shot_type']
    # is_off_wing, is_rebound, is_rush are binary, passthrough
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numeric_features),
            ('cat', OneHotEncoder(handle_unknown='ignore'), categorical_features)
        ],
        remainder='passthrough'
    )
    
    clf = Pipeline(steps=[('preprocessor', preprocessor),
                          ('classifier', LogisticRegression(solver='lbfgs', max_iter=1000))])
    
    clf.fit(X_train, y_train)
    return clf

# Train XGBoost
def train_xgboost(X_train, y_train):
    print("Training XGBoost...")
    
    numeric_features = ['score_differential', 'time_since_last_event']
    categorical_features = ['spatial_bin', 'shot_type']
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numeric_features),
            ('cat', OneHotEncoder(handle_unknown='ignore'), categorical_features)
        ],
        remainder='passthrough'
    )
    
    clf = Pipeline(steps=[('preprocessor', preprocessor),
                          ('classifier', xgb.XGBClassifier(use_label_encoder=False, eval_metric='logloss'))])
    
    clf.fit(X_train, y_train)
    return clf

# Evaluate
def evaluate_model(model, X_test, y_test, model_name="Model"):
    print(f"Evaluating {model_name}...")
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    
    auc = roc_auc_score(y_test, y_prob)
    ll = log_loss(y_test, y_prob)
    acc = accuracy_score(y_test, y_pred)
    
    print(f"  AUC: {auc:.4f}")
    print(f"  Log Loss: {ll:.4f}")
    print(f"  Accuracy: {acc:.4f}")
    
    return auc, ll

def main():
    # Use the 2025-2026 data for now as a test, or the historical if available
    # We'll try historical first, fallback to 2025
    # Load both historical and new season data
    dfs = []
    try:
        dfs.append(load_data("nhl_historical_shots.csv"))
    except FileNotFoundError:
        print("Historical data not found.")
        
    try:
        dfs.append(load_data("nhl_historical_shots.csv"))
    except FileNotFoundError:
        print("Historical data not found.")
        
    # try:
    #     dfs.append(load_data("nhl_season_2025_2026_shots.csv"))
    # except FileNotFoundError:
    #     print("2025-2026 data not found.")
        
    if not dfs:
        print("No data found to train on.")
        return
        
    df = pd.concat(dfs, ignore_index=True)
    print(f"Total shots for training: {len(df)}")
        
    X, y = preprocess_data(df)
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Logistic Regression
    lr_model = train_logistic_regression(X_train, y_train)
    evaluate_model(lr_model, X_test, y_test, "Logistic Regression")
    
    # XGBoost
    xgb_model = train_xgboost(X_train, y_train)
    evaluate_model(xgb_model, X_test, y_test, "XGBoost")
    
    # Save Best Model (XGBoost usually)
    with open('xg_model_xgb.pkl', 'wb') as f:
        pickle.dump(xgb_model, f)
    print("Saved XGBoost model to xg_model_xgb.pkl")

if __name__ == "__main__":
    main()
