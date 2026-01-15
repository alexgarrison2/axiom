
import csv
from collections import Counter

def debug_dal_record():
    wins = 0
    losses = 0
    otl = 0
    
    results = []
    
    print("Reading gamestats.csv...")
    try:
        with open('public/data/gamestats.csv', 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Check for Dallas (using common name or tricode if available, looks like 'team' column has name)
                if row.get('team') == 'Stars':
                    res = row.get('result', '').strip()
                    results.append(res)
                    
                    # Mimic the React Logic
                    # ['RW', 'OTW', 'SOW', 'W']
                    
                    if res in ['RW', 'OTW', 'SOW', 'W']:
                        wins += 1
                    elif res in ['RL', 'L']:
                        losses += 1
                    elif res in ['OTL', 'SOL']:
                        otl += 1
                        
        print(f"Total Games Found for Stars: {len(results)}")
        print(f"Unique Results: {Counter(results)}")
        print(f"Calculated Record: {wins}-{losses}-{otl}")
        print(f"Calculated Points: {(wins*2) + otl}")
        
    except FileNotFoundError:
        print("gamestats.csv not found in public/data/")

if __name__ == "__main__":
    debug_dal_record()
