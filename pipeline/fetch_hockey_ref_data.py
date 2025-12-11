
import os
import csv
import time
import subprocess

# Configuration
SEASONS = [2023, 2024, 2025, 2026]
OUTPUT_DIR = "/Users/alexgarrison/Downloads/HockeyData/raw_html"
TEAMS_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_teams.csv"

# Mappings (NHL Tricode -> Hockey-Ref Code)
# Most are same.
MAPPING = {
    "VGK": "VEG",
    "UTA": "UTA", # Handles post-2024
}

# ARI handling: If UTA and year < 2025, use ARI.

def get_hockey_ref_code(nhl_code, season):
    code = MAPPING.get(nhl_code, nhl_code)
    
    if nhl_code == "UTA" and season < 2025:
        return "ARI"
        
    return code

def main():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        
    # Read Teams
    teams = []
    with open(TEAMS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            teams.append(row['Team Tricode'])
            
    print(f"Found {len(teams)} teams.")
    
    for season in SEASONS:
        print(f"--- Fetching {season} ---")
        for team in teams:
            ref_code = get_hockey_ref_code(team, season)
            
            # Skip if team didn't exist?
            # ARI didn't exist in 2025+ (became UTA)
            # UTA didn't exist in <2025 (was ARI)
            # My logic: 
            # If UTA and <2025 -> ARI. (Valid, ARI existed)
            # If UTA and >=2025 -> UTA. (Valid)
            # If team is VGK -> VEG. (Valid always)
            # What if I have ARI in my list? I don't, I have UTA.
            # So the logic covers ARI history.
            
            # Check for other relocations? No major ones in this window.
            
            url = f"https://www.hockey-reference.com/teams/{ref_code}/{season}_games.html"
            output_file = os.path.join(OUTPUT_DIR, f"{season}_{team}.html") # Store using NHL code
            
            if os.path.exists(output_file):
                # print(f"Skipping {output_file}, exists.")
                continue
                
            print(f"Downloading {team} ({ref_code}) {season}...")
            
            # Use curl
            cmd = f"curl -s '{url}' -o '{output_file}'"
            subprocess.run(cmd, shell=True)
            
            # Tiny sleep to be nice
            time.sleep(1.0) 

if __name__ == "__main__":
    main()
