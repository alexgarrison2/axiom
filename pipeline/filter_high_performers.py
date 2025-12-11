
import csv

WIN_PCT_CSV = "/Users/alexgarrison/Downloads/HockeyData/saturday_home_win_pct.csv"
MAPPING = {
    "VGK": "VEG",
    "UTA": "UTA", 
}

def main():
    targets = []
    print("Reading Win % Data...")
    
    with open(WIN_PCT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pct_str = row['Saturday Home Win %'].replace('%', '')
            try:
                pct = float(pct_str)
            except:
                pct = 0.0
                
            if pct >= 65.0:
                print(f"Found Target: {row['Team']} ({pct}%)")
                targets.append(row['Team'])
                
    # Generate URLs
    SEASONS = [2025, 2026]
    urls = []
    for s in SEASONS:
        for t in targets:
            code = MAPPING.get(t, t)
            # Special case: UTA didn't exist in 2024 (Season 2024 is 2023-24). 
            # We are looking at "Since 2024-25" which is Season 2025.
            # So UTA is fine for 2025.
            # If we were looking at 2024, UTA would be ARI.
            # But request is "Since 2024-25" for attendance.
            
            url = f"https://www.hockey-reference.com/teams/{code}/{s}_games.html"
            name = f"{s}_{t}.html"
            urls.append((url, name))
            
    print("\nBROWSER PROMPT:")
    print("-" * 20)
    print("Visit the following URLs and extract the HTML of the schedule table (id='games').")
    print("For each URL, output the content in the following format:")
    print("=== FILE: [Filename] ===")
    print("[HTML Content]")
    print("=== END FILE ===")
    print("")
    print("URLs:")
    for u, n in urls:
        print(f"- URL: {u} (Filename: {n})")

if __name__ == "__main__":
    main()
