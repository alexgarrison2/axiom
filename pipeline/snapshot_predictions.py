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


def ev_pct(row, side):
    """SiteHistory keeps EV as a percentage.  predictions_detailed.csv v2
    (schema_version 2) stores it as a fraction of the stake."""
    val = row.get(f'{side}_ev', '')
    if not val:
        return ''
    if str(row.get('schema_version', '')).split('.')[0] == '2':
        try:
            return f"{float(val) * 100:.2f}"
        except ValueError:
            return val
    return val

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

FIELDNAMES = [
    'date', 'gameid', 'timestamp', 'run', 'awayteam',
    'away_starter', 'away_xG', 'away_win%', 'away_xGOdds', 'away_Odds', 'away_EV', 'away_bet',
    'hometeam', 'home_starter', 'home_xG', 'home_win%', 'home_xGOdds', 'home_Odds', 'home_EV', 'home_bet',
    # v2 additions: UTC snapshot time, model version, model-only and
    # de-vigged market home probabilities (model_report's rolling gate).
    'timestamp_utc', 'model_version', 'home_model%', 'home_market%',
    # 10-digit NHL gameId, so /api/odds-history can find a game's rows by id.
    'nhl_game_id',
]


def _is_pregame(row, now_utc):
    """Only games that have not started get a snapshot row: a frozen (started)
    row carries the old prediction, and a post-puck-drop row never counts."""
    status = row.get('prediction_status')
    if status in ('no_pregame_prediction', 'no_model', 'frozen'):
        return False
    start = (row.get('start_time_utc') or '').strip()
    if start:
        try:
            t = datetime.datetime.fromisoformat(start.replace('Z', '+00:00'))
            if t.tzinfo is None:
                t = t.replace(tzinfo=datetime.timezone.utc)
            return t > now_utc
        except ValueError:
            pass
    return True


def snapshot(predictions_path=None, history_dir=None, now_utc=None):
    """Append this run's pregame rows to SiteHistory/<Central date>.csv.

    A game gets a new row only when something it shows changed since its
    latest stored row (price, win %, starter, xG, bet), so every lite run that
    moves a market price adds a timestamped point for that game until puck
    drop (the line-movement chart), and a no-change run leaves the file alone.
    The file is written without the old blank separator rows (readers skip
    them in older files)."""
    ct = pytz.timezone('US/Central')
    now_utc = (now_utc or datetime.datetime.now(datetime.timezone.utc)).replace(microsecond=0)
    now_ct = now_utc.astimezone(ct)
    stamp_utc = now_utc.strftime('%Y-%m-%dT%H:%M:%SZ')
    date_str = now_ct.strftime('%Y-%m-%d')
    time_str = now_ct.strftime('%H:%M')

    # Paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    predictions_path = predictions_path or os.path.join(script_dir, '..', 'data', 'predictions_detailed.csv')
    history_dir = history_dir or os.path.join(script_dir, '..', 'public', 'data', 'SiteHistory')
    os.makedirs(history_dir, exist_ok=True)
    history_file = os.path.join(history_dir, f'{date_str}.csv')

    if not os.path.exists(predictions_path):
        print(f"[snapshot] predictions_detailed.csv not found at {predictions_path}")
        return

    all_rows = []
    if os.path.exists(history_file) and os.path.getsize(history_file) > 0:
        with open(history_file, 'r') as f:
            for row in csv.DictReader(f):
                if row.get('gameid'):  # skip blank separator rows (older files)
                    all_rows.append(row)
    run_number = len({r.get('run', '') for r in all_rows}) + 1

    # Read today's pregame predictions
    rows_to_write = []
    id_map = {}  # legacy gameid -> 10-digit NHL id, to back-fill rows written before nhl_game_id
    with open(predictions_path, 'r') as f:
        for row in csv.DictReader(f):
            if row.get('game_date', '') != date_str:
                continue
            if row.get('game_id') and row.get('nhl_game_id'):
                id_map[row['game_id']] = row['nhl_game_id']
            if not _is_pregame(row, now_utc):
                continue
            wager = row.get('wager_recommendation', '')
            # xGOdds is the fair line of the PUBLISHED win % (the blend); since
            # fix1-G1 *_model_odds is the model-only line (older CSVs: model_odds only).
            fair = {side: row.get(f'{side}_blend_odds') or row.get(f'{side}_model_odds', '')
                    for side in ('home', 'away')}
            rows_to_write.append({
                'date': now_ct.strftime('%-m/%-d/%y'),
                'gameid': row.get('game_id', ''),
                'timestamp': time_str,
                'timestamp_utc': stamp_utc,
                'run': run_number,
                'model_version': row.get('model_version', ''),
                'home_model%': format_pct(row.get('home_model_win_pct', '')),
                'home_market%': format_pct(row.get('home_vegas_win_pct', '')),
                'nhl_game_id': row.get('nhl_game_id', ''),
                'awayteam': row.get('away_team', ''),
                'hometeam': row.get('home_team', ''),

                'away_starter': format_starter(row.get('away_starter', '')),
                'away_xG': row.get('away_xg', ''),
                'away_win%': format_pct(row.get('away_win_pct', '')),
                'away_xGOdds': format_odds(fair['away']),
                'away_Odds': format_odds(row.get('away_vegas_odds', '')),
                'away_EV': format_ev(ev_pct(row, 'away')),
                'away_bet': format_away_bet(wager),

                'home_starter': format_starter(row.get('home_starter', '')),
                'home_xG': row.get('home_xg', ''),
                'home_win%': format_pct(row.get('home_win_pct', '')),
                'home_xGOdds': format_odds(fair['home']),
                'home_Odds': format_odds(row.get('home_vegas_odds', '')),
                'home_EV': format_ev(ev_pct(row, 'home')),
                'home_bet': format_home_bet(wager),
            })

    if not rows_to_write:
        print(f"[snapshot] No pregame games found for {date_str}")
        return {'status': 'ok', 'rows_written': 0}

    fieldnames = FIELDNAMES
    same_keys = [k for k in fieldnames if k not in ('date', 'timestamp', 'timestamp_utc', 'run', 'nhl_game_id')]

    def _norm(r):
        return tuple(str(r.get(k, '')).replace('%', '').replace('+', '') for k in same_keys)

    latest = {}
    for row in all_rows:
        if int(row.get('run') or 0) >= int(latest.get(row['gameid'], {}).get('run') or 0):
            latest[row['gameid']] = row
    changed = [r for r in rows_to_write if r['gameid'] not in latest or _norm(latest[r['gameid']]) != _norm(r)]
    if not changed:
        print(f"[snapshot] {len(rows_to_write)} game(s) unchanged since the last run — not appended")
        return {'status': 'ok', 'rows_written': 0}

    all_rows.extend(changed)
    for row in all_rows:
        if not row.get('nhl_game_id') and id_map.get(row.get('gameid')):
            row['nhl_game_id'] = id_map[row['gameid']]

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

    all_rows.sort(key=lambda r: (r.get('gameid', ''), int(r.get('run', 0))))

    tmp = history_file + '.tmp'
    with open(tmp, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        for row in all_rows:   # no blank separator rows
            writer.writerow(row)
    os.replace(tmp, history_file)

    print(f"[snapshot] Run #{run_number}: added {len(changed)} of {len(rows_to_write)} pregame game(s) "
          f"to {history_file}")
    return {'status': 'ok', 'rows_written': len(changed)}


if __name__ == '__main__':
    snapshot()
