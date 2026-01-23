
import pandas as pd
import xgboost as xgb
import pickle
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, log_loss, accuracy_score

DATA_FILE = "data/training_data_advanced_shots.csv"
MODEL_FILE = "xg_model_xgb_edge.pkl"

def train():
    print(f"Loading data from {DATA_FILE}...")
    df = pd.read_csv(DATA_FILE)
    
    # Define Features
    features = [
        'dist_to_net', 
        'angle', 
        'implied_speed', 
        'is_rebound', 
        'royal_road'
    ]
    target = 'is_goal'
    
    # Drop NaNs just in case
    df = df.dropna(subset=features + [target])
    
    X = df[features]
    y = df[target]
    
    print(f"Training on {len(df)} samples with features: {features}")
    
    # Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Train XGBoost
    model = xgb.XGBClassifier(
        objective='binary:logistic',
        eval_metric='logloss',
        use_label_encoder=False,
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    preds_prob = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, preds_prob)
    loss = log_loss(y_test, preds_prob)
    
    print("\n--- Model Evaluation ---")
    print(f"AUC: {auc:.4f}")
    print(f"Log Loss: {loss:.4f}")
    
    # Feature Importance
    print("\n--- Feature Importance ---")
    importance = model.feature_importances_
    for name, val in zip(features, importance):
        print(f"{name}: {val:.4f}")
        
    # Save
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump(model, f)
    print(f"\nModel saved to {MODEL_FILE}")

if __name__ == "__main__":
    train()
