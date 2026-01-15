
import urllib.request
import ssl
import re

URL = "https://www.hockey-reference.com/teams/PIT/2026_gamelog.html"

def debug_columns():
    print(f"Fetching {URL}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    }
    req = urllib.request.Request(URL, headers=headers)
    context = ssl._create_unverified_context()
    
    with urllib.request.urlopen(req, context=context) as response:
        html = response.read().decode('utf-8')
        
    # Find a row
    row_pattern = re.findall(r'<tr id="team_games\..*?>(.*?)</tr>', html, re.DOTALL)
    print(f"Found {len(row_pattern)} rows.")
    
    if len(row_pattern) > 0:
        # Inspect first row (or a specific one)
        # Let's look at the row for 2026-01-08 vs NJD where I have 1 GA
        target_row = None
        for r in row_pattern:
            if "2026-01-08" in r:
                target_row = r
                print("Found target row (2026-01-08 vs NJD)")
                break
        
        if not target_row:
            target_row = row_pattern[0]
            print("Target row not found, using first row.")
            
        print("\n--- Columns in Row ---")
        # Extract all data-stat
        stats = re.findall(r'data-stat="(.*?)"[^>]*>(.*?)</td>', target_row, re.DOTALL)
        for stat, val in stats:
            # Clean val
            clean_val = re.sub(r'<[^>]+>', '', val).strip()
            print(f"{stat}: {clean_val}")

if __name__ == "__main__":
    debug_columns()
