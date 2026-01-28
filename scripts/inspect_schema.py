import os
import psycopg2
from dotenv import load_dotenv

# Load env (so we don't have to hardcode password)
load_dotenv()

# Use verified connection details
DB_HOST = os.environ.get("DB_HOST", "aws-1-us-east-2.pooler.supabase.com")
DB_NAME = "postgres"
DB_USER = "postgres.bmvxgdqfagpkqbagcdce"
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = "6543"

if not DB_PASSWORD:
    print("Error: DB_PASSWORD not found.")
    exit(1)

try:
    print("Connecting to Supabase to inspect 'predictions' table...")
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        port=DB_PORT
    )
    cur = conn.cursor()
    
    # Query schema
    cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'predictions';
    """)
    
    columns = cur.fetchall()
    print(f"\nFound {len(columns)} columns in 'predictions':")
    for col in columns:
        print(f" - {col[0]} ({col[1]})")
        
    cur.close()
    conn.close()

except Exception as e:
    print(f"Error: {e}")
