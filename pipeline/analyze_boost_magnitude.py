
import csv
from datetime import datetime

INPUT_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_api_history.csv"
TARGETS = ["BOS", "UTA", "TBL", "LAK", "DAL", "FLA"]

def main():
    stats = {}
    
    # Initialize
    for t in TARGETS:
        stats[t] = {
            'sat_wins': 0, 'sat_games': 0,
            'all_wins': 0, 'all_games': 0
        }
    
    with open(INPUT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            home_team = row['home_team']
            winner = row['winner']
            date_str = row['date']
            
            # Map ARI -> UTA?
            # User treated UTA separately (71.4%) vs ARI (63.6%).
            # Let's keep them separate as per previous report.
            # But wait, purely for "Franchise" strength?
            # The prompt identified "UTA" as the target (71.4%).
            # So I will look for "UTA" rows.
            
            if home_team not in TARGETS:
                continue
                
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                day = dt.strftime("%A")
            except:
                continue
            
            # Overall Home
            stats[home_team]['all_games'] += 1
            if winner == "HOME":
                stats[home_team]['all_wins'] += 1
                
            # Saturday Home
            if day == "Saturday":
                stats[home_team]['sat_games'] += 1
                if winner == "HOME":
                    stats[home_team]['sat_wins'] += 1

    print(f"{'Team':<5} | {'Sat Win %':<10} | {'All Home %':<10} | {'Diff %':<10} | {'Multiplier':<10}")
    print("-" * 65)
    
    total_diff = 0
    count = 0
    
    for t in TARGETS:
        s = stats[t]
        if s['sat_games'] == 0 or s['all_games'] == 0:
            continue
            
        sat_pct = s['sat_wins'] / s['sat_games']
        all_pct = s['all_wins'] / s['all_games']
        diff = sat_pct - all_pct
        multiplier = sat_pct / all_pct if all_pct > 0 else 0
        
        print(f"{t:<5} | {sat_pct:.1%}     | {all_pct:.1%}     | {diff:+.1%}     | {multiplier:.2f}x")
        
        total_diff += diff
        count += 1
        
    if count > 0:
        avg_diff = total_diff / count
        print("-" * 65)
        print(f"AVERAGE DIFFERENTIAL: {avg_diff:+.1%}")

if __name__ == "__main__":
    main()
