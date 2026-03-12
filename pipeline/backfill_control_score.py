"""
Backfills 'control_score' into the gamestats CSV.

control_score = weighted_seconds_sum / total_game_seconds
Weight per second based on score differential from team's perspective:
  tied        ->  1.0
  leading +1  ->  1.2
  leading +2  ->  1.5
  leading +3+ ->  2.0
  trailing -1 ->  0.8
  trailing -2 ->  0.5
  trailing -3 ->  0.0

Sources (in order of preference):
  1. nhl_season_2025_2026_pbp.csv  (fast, no API calls)
  2. NHL API play-by-play endpoint  (for games missing from PBP CSV)
"""

import os
import time
import requests
import pandas as pd

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
PBP_CSV      = os.path.join(PIPELINE_DIR, "nhl_season_2025_2026_pbp.csv")
STATS_CSV    = os.path.join(PIPELINE_DIR, "nhl_season_2025_2026_gamestats.csv")
PUBLIC_CSV   = os.path.join(PIPELINE_DIR, "../public/data/gamestats.csv")
DATA_CSV     = os.path.join(PIPELINE_DIR, "../data/gamestats.csv")

NHL_PBP_URL  = "https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
REQUEST_DELAY = 0.3  # seconds between API requests


def get_control_weight(score_diff: int) -> float:
    if score_diff == 0:    return 1.0
    elif score_diff == 1:  return 1.2
    elif score_diff == 2:  return 1.5
    elif score_diff >= 3:  return 2.0
    elif score_diff == -1: return 0.8
    elif score_diff == -2: return 0.5
    else:                  return 0.0  # trailing by 3+


def time_to_seconds(period: int, time_str: str) -> int:
    """Convert period + mm:ss into absolute seconds from game start."""
    try:
        m, s = map(int, str(time_str).split(':'))
    except Exception:
        return (period - 1) * 1200
    return (period - 1) * 1200 + m * 60 + s


def compute_from_events(events: list[dict]) -> dict:
    """
    Given a list of dicts with keys:
      period, sort_order, time_in_period, home_score, away_score
    (sorted by period/sort_order, shootout excluded),
    returns {'home': float, 'away': float}.
    """
    home_sum = 0.0
    away_sum = 0.0
    prev_abs  = 0
    prev_home = 0
    prev_away = 0

    for ev in events:
        period   = int(ev['period'])
        curr_abs = time_to_seconds(period, ev['time_in_period'])
        duration = curr_abs - prev_abs

        if duration > 0:
            diff = prev_home - prev_away
            home_sum += get_control_weight(diff)  * duration
            away_sum += get_control_weight(-diff) * duration

        prev_abs  = curr_abs
        prev_home = int(ev['home_score'])
        prev_away = int(ev['away_score'])

    total = prev_abs
    if total <= 0:
        return {}

    return {
        'home': round(home_sum / total, 4),
        'away': round(away_sum / total, 4),
    }


def compute_from_pbp_df(game_df: pd.DataFrame) -> dict:
    """Compute from a slice of the PBP CSV DataFrame."""
    game_df = game_df[game_df['period'] < 5].copy()
    if game_df.empty:
        return {}

    if 'is_home_team' in game_df.columns:
        rows = game_df[game_df['is_home_team'] == True]
    else:
        rows = game_df.drop_duplicates(subset=['sort_order'])

    rows = rows.sort_values(['period', 'sort_order'])

    events = [
        {
            'period':         int(r['period']),
            'sort_order':     int(r['sort_order']),
            'time_in_period': str(r['time_in_period']),
            'home_score':     int(r['home_score_running']),
            'away_score':     int(r['away_score_running']),
        }
        for _, r in rows.iterrows()
    ]
    return compute_from_events(events)


def fetch_from_api(game_id: str) -> dict:
    """Fetch play-by-play from the NHL API and compute control scores."""
    url = NHL_PBP_URL.format(game_id=game_id)
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"    API error for {game_id}: {e}")
        return {}

    plays = data.get('plays', [])
    if not plays:
        return {}

    events = []
    for p in sorted(plays, key=lambda x: x.get('sortOrder', 0)):
        pd_info = p.get('periodDescriptor', {})
        period  = pd_info.get('number', 0)
        if period >= 5:          # skip shootout
            continue
        period_type = pd_info.get('periodType', '')
        if period_type == 'SO': # also skip shootout by type
            continue

        details = p.get('details', {})
        home_score = details.get('homeScore', None)
        away_score = details.get('awayScore', None)

        # Running scores are in the root-level homeTeam/awayTeam score fields
        # Some API versions embed it differently; fall back to details
        if home_score is None:
            home_score = p.get('homeTeamDefendingSide') and None  # not useful
            home_score = 0
        if away_score is None:
            away_score = 0

        # Better: accumulate goals from goal events
        # The API response has running scores in the play details for goal events.
        # Use the top-level score trackers instead.
        events.append({
            'period':         period,
            'sort_order':     p.get('sortOrder', 0),
            'time_in_period': p.get('timeInPeriod', '00:00'),
            'home_score':     home_score,
            'away_score':     away_score,
        })

    if not events:
        return {}

    # The NHL API doesn't give running scores per event in a single field.
    # Reconstruct running score by accumulating goals from 'goal' events.
    events.sort(key=lambda x: (x['period'], x['sort_order']))

    running_home = 0
    running_away = 0

    for p in sorted(plays, key=lambda x: x.get('sortOrder', 0)):
        pd_info = p.get('periodDescriptor', {})
        period = pd_info.get('number', 0)
        period_type = pd_info.get('periodType', '')
        if period >= 5 or period_type == 'SO':
            continue
        if p.get('typeDescKey') == 'goal':
            details = p.get('details', {})
            running_home = details.get('homeScore', running_home)
            running_away = details.get('awayScore', running_away)

    # Re-fetch with running scores
    running_home = 0
    running_away = 0
    rebuilt: list[dict] = []
    for p in sorted(plays, key=lambda x: x.get('sortOrder', 0)):
        pd_info = p.get('periodDescriptor', {})
        period = pd_info.get('number', 0)
        period_type = pd_info.get('periodType', '')
        if period >= 5 or period_type == 'SO':
            continue

        rebuilt.append({
            'period':         period,
            'sort_order':     p.get('sortOrder', 0),
            'time_in_period': p.get('timeInPeriod', '00:00'),
            'home_score':     running_home,
            'away_score':     running_away,
        })

        if p.get('typeDescKey') == 'goal':
            details = p.get('details', {})
            running_home = details.get('homeScore', running_home)
            running_away = details.get('awayScore', running_away)

    # Add one more entry at the last event time with the final score
    if rebuilt:
        last = dict(rebuilt[-1])
        last['home_score'] = running_home
        last['away_score'] = running_away
        rebuilt.append(last)

    return compute_from_events(rebuilt)


def main():
    print("Reading gamestats...")
    gs = pd.read_csv(STATS_CSV, low_memory=False)
    print(f"  {len(gs):,} rows")

    # ── Step 1: Fill from PBP CSV ────────────────────────────────────────
    pbp_cols = ['game_id', 'period', 'sort_order', 'time_in_period',
                'home_score_running', 'away_score_running', 'is_home_team']
    print("Reading PBP CSV...")
    pbp = pd.read_csv(PBP_CSV, usecols=pbp_cols, low_memory=False)
    print(f"  {len(pbp):,} PBP rows across {pbp['game_id'].nunique()} games")

    results: dict = {}
    for game_id, group in pbp.groupby('game_id'):
        scores = compute_from_pbp_df(group)
        if scores:
            results[str(game_id)] = scores

    print(f"  PBP CSV: computed scores for {len(results)} games")

    # ── Step 2: Fill missing from NHL API ────────────────────────────────
    pbp_game_ids = set(results.keys())
    all_game_ids  = set(gs['game_id'].astype(str).unique())
    missing_ids   = all_game_ids - pbp_game_ids
    print(f"  Fetching {len(missing_ids)} games from NHL API...")

    for i, gid in enumerate(sorted(missing_ids)):
        scores = fetch_from_api(gid)
        if scores:
            results[gid] = scores
        if (i + 1) % 50 == 0:
            print(f"    {i+1}/{len(missing_ids)} done...")
        time.sleep(REQUEST_DELAY)

    print(f"  Total games with scores: {len(results)}")

    # ── Step 3: Map back onto gamestats ──────────────────────────────────
    def assign_score(row):
        scores = results.get(str(row['game_id']))
        if not scores:
            return None
        return scores['home'] if row['home_away'] == 'Home' else scores['away']

    gs['control_score'] = gs.apply(assign_score, axis=1)

    filled  = gs['control_score'].notna().sum()
    missing = gs['control_score'].isna().sum()
    print(f"  Filled: {filled}, Still missing: {missing}")

    # ── Step 4: Save ────────────────────────────────────────────────────
    gs.to_csv(STATS_CSV, index=False)
    print(f"  Saved -> {STATS_CSV}")

    for dest in [PUBLIC_CSV, DATA_CSV]:
        dest = os.path.normpath(dest)
        if os.path.exists(os.path.dirname(dest)):
            gs.to_csv(dest, index=False)
            print(f"  Synced -> {dest}")

    print("Done.")


if __name__ == "__main__":
    main()
