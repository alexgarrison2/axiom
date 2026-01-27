import csv
import datetime
import os
import sys
import psycopg2

# Supabase Connection Details
# These should be set in the environment variables for security
DB_HOST = os.environ.get("DB_HOST", "aws-0-us-east-2.pooler.supabase.com")
DB_NAME = os.environ.get("DB_NAME", "postgres")
# Pooler requires user.project_ref format
DB_USER = os.environ.get("DB_USER", "postgres.bmvxgdqfagpkqbagcdce")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = os.environ.get("DB_PORT", "6543") # Use 6543 for transaction pooler, 5432 for session

CSV_PATH = "public/data/predictions_detailed.csv"
TABLE_NAME = "prediction_snapshots"

def get_batch_id():
    now = datetime.datetime.now()
    date_str = now.strftime("%m%d%Y")
    hour = now.hour
    
    if hour < 12:
        batch_num = 1
    elif hour < 16:
        batch_num = 2
    else:
        batch_num = 3
        
    return f"{date_str}_batch{batch_num}"

def clean_odds(val):
    if not val or val == "N/A": return None
    return int(val.replace("+", ""))

def clean_float(val):
    if not val or val == "N/A" or val == "": return None
    return float(val)

def generate_and_execute_snapshot():
    if not DB_PASSWORD:
        print("Error: DB_PASSWORD environment variable is not set.")
        sys.exit(1)

    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    batch_id = get_batch_id()
    print(f"Starting snapshot for Batch: {batch_id}")
    
    try:
        # 1. Read Data
        data_to_insert = []
        with open(CSV_PATH, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["game_date"] != today_str:
                    continue
                
                # Prepare row data (handling types for psycopg2)
                record = (
                    batch_id,
                    row["game_id"],
                    row["home_team"],
                    row["away_team"],
                    clean_odds(row["home_model_odds"]),
                    clean_odds(row["away_model_odds"]),
                    row["home_vegas_odds"], # Keep as text
                    row["away_vegas_odds"], # Keep as text
                    clean_float(row["home_xg"]),
                    clean_float(row["away_xg"]),
                    clean_float(row["home_ev"]),
                    clean_float(row["away_ev"]),
                    clean_float(row.get("home_gas")),
                    clean_float(row.get("away_gas")),
                    row["wager_recommendation"]
                )
                data_to_insert.append(record)
        
        if not data_to_insert:
            print(f"No games found for today ({today_str}). nothing to upload.")
            return

        # 2. Connect to DB
        print(f"Connecting to database {DB_HOST}...")
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            port=DB_PORT
        )
        cur = conn.cursor()

        # 3. Insert Data
        insert_query = f"""
            INSERT INTO {TABLE_NAME} (
                batch_id, game_id, home_team, away_team, 
                home_model_odds, away_model_odds, 
                home_vegas_odds, away_vegas_odds, 
                home_xg, away_xg, 
                home_ev, away_ev, 
                home_gas, away_gas,
                wager_recommendation
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        print(f"Inserting {len(data_to_insert)} records...")
        cur.executemany(insert_query, data_to_insert)
        
        conn.commit()
        cur.close()
        conn.close()
        print("Snapshot successfully uploaded to Supabase.")

            
    except FileNotFoundError:
        print(f"Error: Could not find {CSV_PATH}")
    except psycopg2.Error as e:
        print(f"Database Error: {e}")
    except Exception as e:
        print(f"Unexpected Error: {e}")

if __name__ == "__main__":
    generate_and_execute_snapshot()
