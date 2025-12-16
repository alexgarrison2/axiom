
import csv

def verify_totals():
    href_total = 0
    href_opp_total = 0
    
    # 1. Sum H-Ref Stats for COL
    try:
        with open('href_stats.csv', 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['team'] == 'COL':
                    href_total += int(row['pp_opportunities'])
                    href_opp_total += int(row['opp_pp_opportunities'])
        print(f"H-Ref Total PPO for COL: {href_total}")
        print(f"H-Ref Total PK Opps for COL: {href_opp_total}")
    except FileNotFoundError:
        print("href_stats.csv not found.")

    # 2. Sum Gamestats for COL
    gamestats_total = 0
    try:
        with open('nhl_season_2025_2026_gamestats.csv', 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['team'] == 'Avalanche':
                    # Check if PPO column exists
                    if 'pp_opportunities' in row:
                        gamestats_total += float(row['pp_opportunities']) # float just in case
        print(f"Gamestats Total PPO for COL: {gamestats_total}")
    except FileNotFoundError:
        print("nhl_season_2025_2026_gamestats.csv not found.")

if __name__ == "__main__":
    verify_totals()
