
import csv
from datetime import datetime

INPUT_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_api_history.csv"
OUTPUT_CSV = "/Users/alexgarrison/Downloads/HockeyData/saturday_home_win_pct.csv"

def main():
    team_stats = {}
    
    with open(INPUT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            date_str = row['date']
            home_team = row['home_team']
            winner = row['winner']
            
            # Filter Date >= 2022-10-01 (Already fetched this range)
            # Check for Saturday
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                if dt.strftime("%A") != "Saturday":
                    continue
            except:
                continue
                
            # Filter Season? 
            # Request: "Since 2022-23 season".
            # My fetch started 2022-10-01.
            # So all data in file is relevant.
            
            if home_team not in team_stats:
                team_stats[home_team] = {'wins': 0, 'games': 0}
            
            team_stats[home_team]['games'] += 1
            if winner == "HOME":
                team_stats[home_team]['wins'] += 1
                
    # Calculate %
    results = []
    for team, stats in team_stats.items():
        if stats['games'] > 0:
            pct = stats['wins'] / stats['games']
        else:
            pct = 0.0
            
        results.append({
            'Team': team,
            'Saturday Home Win %': f"{pct:.1%}",
            'Raw': f"{stats['wins']}/{stats['games']}"
        })
        
    results.sort(key=lambda x: x['Team'])
    
    # Save
    with open(OUTPUT_CSV, 'w') as f:
        writer = csv.DictWriter(f, fieldnames=['Team', 'Saturday Home Win %', 'Raw'])
        writer.writeheader()
        writer.writerows(results)
        
    print(f"Saved Win % analysis to {OUTPUT_CSV}")
    
    # Print Table
    print(f"{'Team':<5} | {'Win %':<10} | {'Record':<10}")
    print("-" * 30)
    for r in results:
        print(f"{r['Team']:<5} | {r['Saturday Home Win %']:<10} | {r['Raw']:<10}")

if __name__ == "__main__":
    main()
