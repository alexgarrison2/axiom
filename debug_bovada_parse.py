import json
from datetime import datetime

with open('bovada_raw.json', 'r') as f:
    data = json.load(f)

for item in data:
    events = item.get('events', [])
    for event in events:
        desc = event.get('description')
        start_time_ms = event.get('startTime', 0)
        date_str = datetime.fromtimestamp(start_time_ms / 1000.0).strftime('%Y-%m-%d')
        
        has_game_lines = False
        has_moneyline = False
        
        for group in event.get('displayGroups', []):
            if group.get('description') == 'Game Lines':
                has_game_lines = True
                for market in group.get('markets', []):
                    if market.get('description') == 'Moneyline':
                        has_moneyline = True
                        break
        
        print(f"Matchup: {desc}")
        print(f"  Date: {date_str} (startTime: {start_time_ms})")
        print(f"  Game Lines: {has_game_lines}, Moneyline: {has_moneyline}")
        print("-" * 20)
