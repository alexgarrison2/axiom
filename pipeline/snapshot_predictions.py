"""
snapshot_predictions.py
-----------------------
Called after predict_games.py on each pipeline run.
Reads the current predictions_detailed.csv and appends a timestamped snapshot
to a daily CSV file in public/data/SiteHistory/<YYYY-MM-DD>.csv.

Each row captures one game's prediction at a specific run, so you can track
how model outputs change throughout the day as lineups / odds update.
"""

import csv
import os
import datetime
import pytz

def snapshot():
    ct = pytz.timezone('US/Central')
    now_ct = datetime.datetime.now(ct)
    date_str = now_ct.strftime('%Y-%m-%d')
    time_str = now_ct.strftime('%H:%M')

    # Paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    predictions_path = os.path.join(script_dir, '..', 'data', 'predictions_detailed.csv')
    history_dir = os.path.join(script_dir, '..', 'public', 'data', 'SiteHistory')
    os.makedirs(history_dir, exist_ok=True)
    history_file = os.path.join(history_dir, f'{date_str}.csv')

    if not os.path.exists(predictions_path):
        print(f"[snapshot] predictions_detailed.csv not found at {predictions_path}")
        return

    # Determine run number: count existing rows for today + 1
    run_number = 1
    if os.path.exists(history_file):
        with open(history_file, 'r') as f:
            reader = csv.DictReader(f)
            runs_seen = set()
            for row in reader:
                runs_seen.add(row.get('run', ''))
            run_number = len(runs_seen) + 1

    # Read today's predictions
    rows_to_write = []
    with open(predictions_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            game_date = row.get('game_date', '')
            # Only snapshot games for today
            if game_date != date_str:
                continue

            rows_to_write.append({
                'date': now_ct.strftime('%-m/%-d/%y'),
                'gameid': row.get('game_id', ''),
                'timestamp': time_str,
                'run': run_number,
                'awayteam': row.get('away_team', ''),
                'hometeam': row.get('home_team', ''),
                
                'away_starter': row.get('away_starter', ''),
                'away_xG': row.get('away_xg', ''),
                'away_win%': row.get('away_win_pct', ''),
                'away_xGOdds': row.get('away_model_odds', ''),
                'away_Odds': row.get('away_vegas_odds', ''),
                'away_EV': row.get('away_ev', ''),
                
                'home_starter': row.get('home_starter', ''),
                'home_xG': row.get('home_xg', ''),
                'home_win%': row.get('home_win_pct', ''),
                'home_xGOdds': row.get('home_model_odds', ''),
                'home_Odds': row.get('home_vegas_odds', ''),
                'home_EV': row.get('home_ev', ''),
            })

    if not rows_to_write:
        print(f"[snapshot] No games found for {date_str}")
        return

    # Write/append to daily history file
    fieldnames = [
        'date', 'gameid', 'timestamp', 'run', 'awayteam', 'hometeam',
        'away_starter', 'away_xG', 'away_win%', 'away_xGOdds', 'away_Odds', 'away_EV',
        'home_starter', 'home_xG', 'home_win%', 'home_xGOdds', 'home_Odds', 'home_EV'
    ]

    all_rows = []
    if os.path.exists(history_file) and os.path.getsize(history_file) > 0:
        with open(history_file, 'r') as f:
            reader = csv.DictReader(f)
            all_rows = list(reader)

    all_rows.extend(rows_to_write)
    all_rows.sort(key=lambda r: (r.get('gameid', ''), int(r.get('run', 0))))

    with open(history_file, 'w', newline='') as f:
        # extrasaction='ignore' prevents errors if old rows had fields not in new fieldnames (unlikely here)
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"[snapshot] Run #{run_number}: added {len(rows_to_write)} games to {history_file}")


if __name__ == '__main__':
    snapshot()
