import os
import socket
import psycopg2
from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = "bmvxgdqfagpkqbagcdce"
PASSWORD = os.environ.get("DB_PASSWORD")

if not PASSWORD:
    print("Error: DB_PASSWORD not found in environment or .env file.")
    exit(1)

# Configuration Options to Test
CONFIGS = [
    {
        "name": "Direct Connection",
        "host": f"db.{PROJECT_ID}.supabase.co",
        "port": 5432,
        "user": "postgres",
        "desc": "Standard direct connection string"
    },
    {
        "name": "Pooler (US East 1)",
        "host": "aws-0-us-east-1.pooler.supabase.com",
        "port": 6543,
        "user": f"postgres.{PROJECT_ID}",
        "desc": "Connection pooler for US East 1"
    },
    {
        "name": "Pooler (EU Central 1)",
        "host": "aws-0-eu-central-1.pooler.supabase.com",
        "port": 6543,
        "user": f"postgres.{PROJECT_ID}",
        "desc": "Connection pooler for EU Central 1 (Alternative Region)"
    },
    {
        "name": "API Host Check",
        "host": f"{PROJECT_ID}.supabase.co",
        "port": 443,
        "user": "N/A",
        "desc": "Checking if API is reachable (Project Status Check)",
        "dns_only": True
    },
    {
        "name": "Pooler (US West 1)",
        "host": "aws-0-us-west-1.pooler.supabase.com",
        "port": 6543,
        "user": f"postgres.{PROJECT_ID}",
        "desc": "Connection pooler for US West 1"
    },
    {
        "name": "Pooler (EU West 1)",
        "host": "aws-0-eu-west-1.pooler.supabase.com",
        "port": 6543,
        "user": f"postgres.{PROJECT_ID}",
        "desc": "Connection pooler for EU West 1"
    }
]

print(f"--- Testing Supabase Connections for Project: {PROJECT_ID} ---\n")

for config in CONFIGS:
    print(f"Testing: {config['name']} ({config['desc']})")
    host = config['host']
    
    # DNS Resolution Check
    try:
        ip = socket.gethostbyname(host)
        print(f"  [DNS] Resolved {host} to {ip}")
    except socket.gaierror:
        print(f"  [DNS] FAILED to resolve {host}. Host does not exist.")
        continue # Skip if we can't resolve
    
    if config.get("dns_only"):
        continue
        
    # Connection Check
    try:
        conn = psycopg2.connect(
            host=host,
            database="postgres",
            user=config['user'],
            password=PASSWORD,
            port=config['port'],
            connect_timeout=5
        )
        conn.close()
        print(f"  [DB] SUCCESS! Connected successfully.\n")
        print(f"*** RECOMMENDED CONFIGURATION ***")
        print(f"DB_HOST={host}")
        print(f"DB_PORT={config['port']}")
        print(f"DB_USER={config['user']}")
        break
    except Exception as e:
        print(f"  [DB] FAILED: {e}\n")

print("--- Test Complete ---")
