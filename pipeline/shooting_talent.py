"""
Shooting Talent Adjustment (Phase 3B)

Computes per-player shooting talent factors — how much a player over/under-
performs their xG — using Bayesian shrinkage.

MoneyPuck considers this their biggest competitive edge.  A wrist shot from
Ovechkin's office is not the same as a wrist shot from a 4th liner, even if
the raw spatial xG is identical.

Approach
--------
1. Aggregate goals vs xG across multiple seasons (weighted: 50/30/20)
2. Apply Bayesian shrinkage: small samples regress toward 1.0 (league avg)
3. Output a lookup: player_id -> talent_multiplier

The multiplier is applied to each shot's xG after the base model scores it.
A multiplier of 1.15 means the player converts 15% more goals than expected.
A multiplier of 0.85 means the player underperforms their shot quality by 15%.

Bayesian formula (conjugate beta-binomial):
    shrunk_ratio = (goals + prior_xG * league_ratio) / (xG + prior_xG)

Where prior_xG controls shrinkage strength:
    - Low xG player (call-up): heavily regressed toward 1.0
    - High xG player (star):   talent dominates, near raw ratio
"""

import json
import os
import sys
import pandas as pd
import numpy as np

# ── Configuration ──────────────────────────────────────────────────────────
PRIOR_XG = 40.0       # Bayesian prior strength (~40 xG worth of league-avg data)
                       # At 40 xG (~550 shots), the prior contributes ~50% weight
                       # A full season top-liner generates ~15-20 xG at 5v5
LEAGUE_RATIO = 1.0     # League-average goals/xG (by definition ~1.0)
TALENT_FLOOR = 0.75    # Don't let anyone be <75% of their xG (extreme shrinkage floor)
TALENT_CEILING = 1.35  # Don't let anyone exceed 135% (prevents small-sample explosions)

# Season weighting for multi-season aggregation
SEASON_WEIGHTS = {
    2025: 0.50,  # Current season (2025-2026)
    2024: 0.30,  # Last season (2024-2025)
    2023: 0.20,  # Two seasons ago (2023-2024)
}

# Strength states to include (EV play is where talent is most stable/repeatable)
TALENT_STRENGTH_STATES = ['5v5']


def extract_season(game_id):
    """Extract season year from NHL game_id (e.g., 2024020567 -> 2024)."""
    return int(str(game_id)[:4])


def compute_shooting_talent(pipeline_dir=None):
    """
    Compute per-player shooting talent factors from shot-level data.

    Returns dict: {player_id: talent_multiplier}
    Also saves to shooting_talent.json.
    """
    if pipeline_dir is None:
        pipeline_dir = os.path.dirname(os.path.abspath(__file__))

    # ── Load all shot data ─────────────────────────────────────────────
    shot_files = [
        os.path.join(pipeline_dir, "nhl_historical_shots.csv"),
        os.path.join(pipeline_dir, "nhl_season_2025_2026_shots.csv"),
    ]

    frames = []
    for f in shot_files:
        if os.path.exists(f):
            df = pd.read_csv(f, usecols=['game_id', 'player_id', 'is_goal',
                                          'xG', 'strength_state'],
                             low_memory=False)
            frames.append(df)
            print(f"  Loaded {len(df):,} shots from {os.path.basename(f)}")
        else:
            print(f"  Warning: {os.path.basename(f)} not found, skipping")

    if not frames:
        print("  No shot data found — returning empty talent map")
        return {}

    all_shots = pd.concat(frames, ignore_index=True)

    # Filter to EV strength states (5v5 is where talent signal is cleanest)
    all_shots = all_shots[all_shots['strength_state'].isin(TALENT_STRENGTH_STATES)]
    print(f"  5v5 shots: {len(all_shots):,}")

    # Extract season and validate
    all_shots['season'] = all_shots['game_id'].apply(extract_season)
    valid_seasons = set(SEASON_WEIGHTS.keys())
    all_shots = all_shots[all_shots['season'].isin(valid_seasons)]

    # Ensure numeric types
    all_shots['is_goal'] = pd.to_numeric(all_shots['is_goal'], errors='coerce').fillna(0)
    all_shots['xG'] = pd.to_numeric(all_shots['xG'], errors='coerce').fillna(0)
    all_shots['player_id'] = pd.to_numeric(all_shots['player_id'], errors='coerce')
    all_shots = all_shots.dropna(subset=['player_id'])
    all_shots['player_id'] = all_shots['player_id'].astype(int)

    # ── Per-season aggregation ─────────────────────────────────────────
    # Aggregate goals and xG per player per season
    season_agg = all_shots.groupby(['player_id', 'season']).agg(
        goals=('is_goal', 'sum'),
        xG=('xG', 'sum'),
        shots=('is_goal', 'count'),
    ).reset_index()

    # ── Multi-season weighted aggregation ──────────────────────────────
    # Apply season weights: more recent seasons matter more
    season_agg['weight'] = season_agg['season'].map(SEASON_WEIGHTS)
    season_agg['w_goals'] = season_agg['goals'] * season_agg['weight']
    season_agg['w_xG'] = season_agg['xG'] * season_agg['weight']
    season_agg['w_shots'] = season_agg['shots'] * season_agg['weight']

    player_agg = season_agg.groupby('player_id').agg(
        goals=('w_goals', 'sum'),
        xG=('w_xG', 'sum'),
        shots=('w_shots', 'sum'),
        n_seasons=('season', 'nunique'),
    ).reset_index()

    # ── Bayesian shrinkage ─────────────────────────────────────────────
    # shrunk_ratio = (weighted_goals + PRIOR_XG * 1.0) / (weighted_xG + PRIOR_XG)
    # This pulls everyone toward 1.0, with more pull for small-sample players
    player_agg['raw_ratio'] = player_agg['goals'] / player_agg['xG'].clip(lower=0.1)
    player_agg['shrunk_ratio'] = (
        (player_agg['goals'] + PRIOR_XG * LEAGUE_RATIO) /
        (player_agg['xG'] + PRIOR_XG)
    )

    # Apply floor/ceiling
    player_agg['talent_mult'] = player_agg['shrunk_ratio'].clip(
        lower=TALENT_FLOOR, upper=TALENT_CEILING
    )

    # ── Diagnostics ────────────────────────────────────────────────────
    n_players = len(player_agg)
    has_signal = player_agg[player_agg['xG'] > 5.0]  # >5 weighted xG = meaningful
    print(f"  Players computed: {n_players}")
    print(f"  Players with meaningful signal (>5 weighted xG): {len(has_signal)}")
    if len(has_signal) > 0:
        print(f"  Talent multiplier range (meaningful): "
              f"{has_signal['talent_mult'].min():.3f} — {has_signal['talent_mult'].max():.3f}")
        print(f"  Talent multiplier mean: {has_signal['talent_mult'].mean():.3f}")
        print(f"  Talent multiplier std:  {has_signal['talent_mult'].std():.3f}")

        # Top overperformers
        top = has_signal.nlargest(5, 'talent_mult')
        print(f"\n  Top 5 overperformers (shrunk):")
        for _, row in top.iterrows():
            print(f"    Player {int(row['player_id'])}: "
                  f"raw={row['raw_ratio']:.2f} → shrunk={row['talent_mult']:.3f} "
                  f"(goals={row['goals']:.1f}, xG={row['xG']:.1f})")

        # Top underperformers
        bottom = has_signal.nsmallest(5, 'talent_mult')
        print(f"\n  Top 5 underperformers (shrunk):")
        for _, row in bottom.iterrows():
            print(f"    Player {int(row['player_id'])}: "
                  f"raw={row['raw_ratio']:.2f} → shrunk={row['talent_mult']:.3f} "
                  f"(goals={row['goals']:.1f}, xG={row['xG']:.1f})")

    # ── Build output dict ──────────────────────────────────────────────
    talent_map = dict(zip(
        player_agg['player_id'].astype(int),
        player_agg['talent_mult'].round(4)
    ))

    # Save to JSON
    out_path = os.path.join(pipeline_dir, "shooting_talent.json")
    # JSON keys must be strings
    talent_json = {str(k): v for k, v in talent_map.items()}
    with open(out_path, 'w') as f:
        json.dump(talent_json, f, indent=2)
    print(f"\n  Saved {len(talent_map)} talent factors to {os.path.basename(out_path)}")

    return talent_map


def load_shooting_talent(pipeline_dir=None):
    """Load pre-computed shooting talent factors from JSON."""
    if pipeline_dir is None:
        pipeline_dir = os.path.dirname(os.path.abspath(__file__))

    path = os.path.join(pipeline_dir, "shooting_talent.json")
    if not os.path.exists(path):
        print("  shooting_talent.json not found — no talent adjustment applied")
        return {}

    with open(path) as f:
        talent_json = json.load(f)

    # Convert string keys back to int
    return {int(k): v for k, v in talent_json.items()}


def apply_shooting_talent(shots_df, talent_map):
    """
    Apply shooting talent multiplier to a shots DataFrame in-place.

    Modifies both 'xG' and 'xG_flurry_adj' columns.
    Players not in the talent_map get 1.0 (no adjustment).

    Parameters
    ----------
    shots_df : pd.DataFrame
        Must have 'player_id' and 'xG' columns. Optionally 'xG_flurry_adj'.
    talent_map : dict
        {player_id: talent_multiplier}

    Returns
    -------
    pd.DataFrame (same object, modified in place)
    """
    if not talent_map:
        return shots_df

    # Map player_id to talent multiplier (default 1.0 for unknown players)
    multipliers = shots_df['player_id'].map(talent_map).fillna(1.0)

    # Apply to raw xG
    shots_df['xG'] = shots_df['xG'] * multipliers

    # Apply to flurry-adjusted xG if it exists
    if 'xG_flurry_adj' in shots_df.columns:
        shots_df['xG_flurry_adj'] = shots_df['xG_flurry_adj'] * multipliers

    # Cap individual shot xG at 1.0 (can't exceed certainty)
    shots_df['xG'] = shots_df['xG'].clip(upper=1.0)
    if 'xG_flurry_adj' in shots_df.columns:
        shots_df['xG_flurry_adj'] = shots_df['xG_flurry_adj'].clip(upper=1.0)

    n_adjusted = (multipliers != 1.0).sum()
    avg_mult = multipliers[multipliers != 1.0].mean() if n_adjusted > 0 else 1.0
    print(f"  Shooting talent: {n_adjusted}/{len(shots_df)} shots adjusted "
          f"(avg multiplier={avg_mult:.3f})")

    return shots_df


if __name__ == "__main__":
    print("Computing shooting talent factors...")
    talent = compute_shooting_talent()
    print(f"\nDone. {len(talent)} player talent factors computed.")
