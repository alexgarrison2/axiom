
import csv
import urllib.request
import os
import time

# Paths
DATA_DIR = "nhl-predictions-app/data"
PUBLIC_LOGOS_DIR = "nhl-predictions-app/public/logos"
TEAMS_CSV = os.path.join(DATA_DIR, "nhl_teams.csv")

def download_logos():
    print(f"Reading teams from {TEAMS_CSV}...")
    
    # Ensure directory exists
    os.makedirs(PUBLIC_LOGOS_DIR, exist_ok=True)
    
    with open(TEAMS_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        teams = list(reader)
        
    print(f"Found {len(teams)} teams. Starting download...")
    
    for team in teams:
        tricode = team.get('Team Tricode')
        url = team.get('Team Logo URL')
        
        if not tricode or not url:
            print(f"Skipping row, missing tricode or url: {team}")
            continue
            
        # Target file
        target_path = os.path.join(PUBLIC_LOGOS_DIR, f"{tricode}.svg")
        
        print(f"Downloading {tricode} from {url}...")
        
        try:
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            req = urllib.request.Request(
                url, 
                data=None, 
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            )
            with urllib.request.urlopen(req, context=ctx) as response:
                if response.status == 200:
                    data = response.read()
                    with open(target_path, 'wb') as out_f:
                        out_f.write(data)
                    print(f"  -> Saved to {target_path}")
                else:
                    print(f"  -> Failed: Status {response.status}")
        except Exception as e:
            print(f"  -> Error: {e}")
            
        # Be nice to the server
        time.sleep(0.2)

if __name__ == "__main__":
    download_logos()
