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

def format_odds(val_str):
    if not val_str:
        return ""
    try:
        val = float(val_str)
        if val > 0:
            return f"+{int(val)}"
        return f"{int(val)}"
    except ValueError:
        return val_str

def format_ev(val_str):
    if not val_str:
        return ""
    try:
        val = float(val_str)
        if val > 0:
            return f"+{val:.2f}"
        return f"{val:.2f}"
    except ValueError:
        return val_str

def format_pct(val_str):
    if not val_str:
        return ""
    try:
        val = float(val_str)
        return f"{val:.1f}%"
    except ValueError:
        return val_str

STATUS_ABBREV = {'Unconfirmed': 'U', 'Likely': 'L', 'Confirmed': 'C'}

def format_starter(val_str):
    """Convert 'Dustin Wolf (Unconfirmed)' to 'Wolf (U)'."""
    import re
    if not val_str:
        return ''
    match = re.match(r'(.+?)\s*\((\w+)\)\s*$', val_str.strip())
    if match:
        full_name, status = match.group(1), match.group(2)
        last_name = full_name.strip().split()[-1]
        abbrev = STATUS_ABBREV.get(status, status)
        return f"{last_name} ({abbrev})"
    # No status in parens — just return last name
    return val_str.strip().split()[-1]

def format_bet(wager_str):
    """Convert 'Home 0.6 Units' or 'Away 1.0 Unit' to '$3.00', blank for No Bet."""
    import re
    if not wager_str or wager_str.strip() == 'No Bet':
        return ''
    match = re.search(r'(\d+(?:\.\d+)?)\s*Units?', wager_str, re.IGNORECASE)
    if not match:
        return ''
    return f"${float(match.group(1)) * 5:.2f}"

def format_away_bet(wager_str):
    """Dollar amount if wager is on the away team, else blank."""
    if not wager_str or 'Away' not in wager_str:
        return ''
    return format_bet(wager_str)

def format_home_bet(wager_str):
    """Dollar amount if wager is on the home team, else blank."""
    if not wager_str or 'Home' not in wager_str:
        return ''
    return format_bet(wager_str)

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
                if row.get('gameid'):  # skip blank separator rows
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

            wager = row.get('wager_recommendation', '')
            rows_to_write.append({
                'date': now_ct.strftime('%-m/%-d/%y'),
                'gameid': row.get('game_id', ''),
                'timestamp': time_str,
                'run': run_number,
                'awayteam': row.get('away_team', ''),
                'hometeam': row.get('home_team', ''),

                'away_starter': format_starter(row.get('away_starter', '')),
                'away_xG': row.get('away_xg', ''),
                'away_win%': format_pct(row.get('away_win_pct', '')),
                'away_xGOdds': format_odds(row.get('away_model_odds', '')),
                'away_Odds': format_odds(row.get('away_vegas_odds', '')),
                'away_EV': format_ev(row.get('away_ev', '')),
                'away_bet': format_away_bet(wager),

                'home_starter': format_starter(row.get('home_starter', '')),
                'home_xG': row.get('home_xg', ''),
                'home_win%': format_pct(row.get('home_win_pct', '')),
                'home_xGOdds': format_odds(row.get('home_model_odds', '')),
                'home_Odds': format_odds(row.get('home_vegas_odds', '')),
                'home_EV': format_ev(row.get('home_ev', '')),
                'home_bet': format_home_bet(wager),
            })

    if not rows_to_write:
        print(f"[snapshot] No games found for {date_str}")
        return

    # Write/append to daily history file
    fieldnames = [
        'date', 'gameid', 'timestamp', 'run', 'awayteam',
        'away_starter', 'away_xG', 'away_win%', 'away_xGOdds', 'away_Odds', 'away_EV', 'away_bet',
        'hometeam', 'home_starter', 'home_xG', 'home_win%', 'home_xGOdds', 'home_Odds', 'home_EV', 'home_bet',
    ]

    # Build bet lookups by gameid so old rows can be backfilled
    away_bet_by_gameid = {r['gameid']: r['away_bet'] for r in rows_to_write}
    home_bet_by_gameid = {r['gameid']: r['home_bet'] for r in rows_to_write}

    all_rows = []
    if os.path.exists(history_file) and os.path.getsize(history_file) > 0:
        with open(history_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get('gameid'):  # skip blank separator rows
                    all_rows.append(row)

    all_rows.extend(rows_to_write)

    # Apply format to all rows (fixes runs from earlier today)
    for row in all_rows:
        row['away_win%'] = format_pct(row.get('away_win%', '').replace('%', ''))
        row['home_win%'] = format_pct(row.get('home_win%', '').replace('%', ''))
        row['away_xGOdds'] = format_odds(row.get('away_xGOdds', '').replace('+', ''))
        row['home_xGOdds'] = format_odds(row.get('home_xGOdds', '').replace('+', ''))
        row['away_Odds'] = format_odds(row.get('away_Odds', '').replace('+', ''))
        row['home_Odds'] = format_odds(row.get('home_Odds', '').replace('+', ''))
        row['away_EV'] = format_ev(row.get('away_EV', '').replace('+', ''))
        row['home_EV'] = format_ev(row.get('home_EV', '').replace('+', ''))
        # Re-format starters (handles old rows with full name + full status)
        row['away_starter'] = format_starter(row.get('away_starter', ''))
        row['home_starter'] = format_starter(row.get('home_starter', ''))
        # Backfill away_bet/home_bet for rows written before these columns existed
        gameid = row.get('gameid', '')
        if not row.get('away_bet') and not row.get('home_bet') and gameid in away_bet_by_gameid:
            row['away_bet'] = away_bet_by_gameid[gameid]
            row['home_bet'] = home_bet_by_gameid[gameid]

    all_rows.sort(key=lambda r: (r.get('gameid', ''), int(r.get('run', 0))))

    with open(history_file, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        prev_gameid = None
        for row in all_rows:
            if prev_gameid is not None and row.get('gameid') != prev_gameid:
                writer.writerow({fn: '' for fn in fieldnames})  # blank separator row
            writer.writerow(row)
            prev_gameid = row.get('gameid')

    print(f"[snapshot] Run #{run_number}: added {len(rows_to_write)} games to {history_file}")


if __name__ == '__main__':
    snapshot()
