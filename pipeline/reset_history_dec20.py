import json
import os

HISTORY_FILE = '../data/prediction_history.json'

if os.path.exists(HISTORY_FILE):
    with open(HISTORY_FILE, 'r') as f:
        data = json.load(f)
    
    initial_count = len(data)
    # Remove entries from 2025-12-20 and onwards
    new_data = [g for g in data if g['date'] < "2025-12-20"]
    
    final_count = len(new_data)
    print(f"Removed {initial_count - final_count} entries (from 2025-12-20+).")
    
    with open(HISTORY_FILE, 'w') as f:
        json.dump(new_data, f, indent=2)
    print("Saved trimmed history.")
else:
    print("History file not found.")
