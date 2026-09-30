import json
import os
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Load env
load_dotenv()

# Supabase connection details come ONLY from the environment (see
# scripts/AUTOMATION_README.md). Nothing identifying the database is hardcoded.
def _env(name, default=None):
    val = os.environ.get(name, "").strip()
    return val or default

DB_HOST = _env("DB_HOST")
DB_NAME = _env("DB_NAME", "postgres")
DB_USER = _env("DB_USER")  # pooler format: postgres.<project-ref>
DB_PASSWORD = _env("DB_PASSWORD")
DB_PORT = _env("DB_PORT", "6543")

HISTORY_PATH = "public/data/prediction_history.json"

def prob_to_odds(prob_pct):
    """Convert Probability % (0-100) to US Odds (Int)"""
    if not prob_pct or prob_pct <= 0 or prob_pct >= 100:
        return 0
    
    if prob_pct > 50:
        # Favorite: - (P / (1-P)) * 100
        p = prob_pct / 100.0
        odds = -1 * (p / (1 - p)) * 100
    elif prob_pct < 50:
        # Underdog: ((1-P) / P) * 100
        p = prob_pct / 100.0
        odds = ((1 - p) / p) * 100
    else:
        odds = 100
        
    return int(odds)

def sync_history():
    missing = [n for n, v in (("DB_HOST", DB_HOST), ("DB_USER", DB_USER), ("DB_PASSWORD", DB_PASSWORD)) if not v]
    if missing:
        print(f"Error: missing environment variable(s): {', '.join(missing)}")
        return

    print(f"Loading history from {HISTORY_PATH}...")
    if not os.path.exists(HISTORY_PATH):
        print("History file not found.")
        return

    with open(HISTORY_PATH, "r") as f:
        history = json.load(f)

    print(f"Found {len(history)} records. Converting...")
    
    records_to_upsert = []
    
    for row in history:
        # Construct Game ID if missing: YYYY-MM-DD-Home-Away
        date_str = row['date']
        home = row['homeTeam']
        away = row['awayTeam']
        game_id = f"{date_str}-{home}-{away}"
        
        home_win_prob = row.get('homeWinProb', 50.0)
        home_odds = prob_to_odds(home_win_prob)
        away_odds = prob_to_odds(100.0 - home_win_prob)
        
        # Prepare tuple matching INSERT columns
        # Columns: game_id, game_date, home_team, away_team, 
        #          home_xg, away_xg, home_model_odds, away_model_odds,
        #          actual_winner
        
        record = (
            game_id,
            date_str,
            home,
            away,
            row.get('homeXg'),
            row.get('awayXg'),
            home_odds,
            away_odds,
            row.get('actualWinner') # Updates later when game finishes
        )
        records_to_upsert.append(record)

    print(f"Connecting to database {DB_HOST}...")
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            port=DB_PORT
        )
        cur = conn.cursor()
        
        print(f"Upserting {len(records_to_upsert)} records to 'predictions' table...")
        
        # Upsert Query (Postgres)
        # We assume game_id is UNIQUE (or PK). If not, we might get duplicates.
        # Ideally table has constraints. We'll use ON CONFLICT (game_id) DO UPDATE
        # CHECK: Does `predictions` have a unique constraint on game_id?
        # INSPECTION showed `game_id` is text. We hope it's unique.
        # If not, we might need to delete by batch or something.
        # Let's assume Unique Index exists on game_id for now.
        
        upsert_sql = """
            INSERT INTO predictions (
                game_id, game_date, home_team, away_team,
                home_xg, away_xg, home_model_odds, away_model_odds,
                actual_winner
            )
            VALUES %s
            ON CONFLICT (game_id) DO UPDATE SET
                actual_winner = EXCLUDED.actual_winner,
                home_xg = EXCLUDED.home_xg,
                away_xg = EXCLUDED.away_xg,
                home_model_odds = EXCLUDED.home_model_odds,
                away_model_odds = EXCLUDED.away_model_odds;
        """
        
        execute_values(cur, upsert_sql, records_to_upsert)
        
        conn.commit()
        print("Success: 'predictions' table synced.")
        
        cur.close()
        conn.close()
        
    except psycopg2.Error as e:
        print(f"Database Error: {e}")
        # Identify if it's a constraint error
        if "unique constraint" not in str(e).lower() and "predictions_game_id_key" not in str(e).lower():
             print("Tip: If valid constraint is missing, duplicates may occur.")

if __name__ == "__main__":
    sync_history()
