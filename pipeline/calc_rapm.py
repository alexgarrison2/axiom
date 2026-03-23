#!/usr/bin/env python3
"""
calc_rapm.py — Regularized Adjusted Plus-Minus (RAPM) for NHL players.

RAPM uses ridge regression on shift-overlap stints to isolate each player's
marginal contribution to on-ice xG generation (offense) and xG suppression
(defense), controlling for every teammate and opponent simultaneously.

This is the gold-standard player isolation technique used by HockeyStats,
HockeyViz Magnus, and Evolving Hockey.

Data flow:
    shifts.csv + shots.csv → stint construction → sparse design matrix
    → ridge regression (2 models: offense + defense) → rapm_scores.json

Output: rapm_scores.json — per-player RAPM offensive and defensive ratings.
"""

import os
import sys
import json
import time
import numpy as np
import pandas as pd
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Name Resolution Overrides ─────────────────────────────────────────────
# Maps shift CSV names (HTML fallback format) to correct NHL player IDs.
# Verified manually against NHL API / player_stats data.
RAPM_NAME_OVERRIDES = {
    "A Greer": 8478421,
    "Alex Debrincat": 8479337,
    "Axel Sandin-pellikka": 8484223,
    "Bobby Mcmann": 8482259,
    "Brayden Mcnabb": 8475188,
    "Cameron Talbot": 8475660,
    "Casey Desmith": 8479193,
    "Charle-edouard D'astous": 8480426,
    "Charles Legault": 8484428,
    "Charlie Mcavoy": 8479325,
    "Cole Mcward": 8484287,
    "Connor Mcdavid": 8478402,
    "Connor Mcmichael": 8481580,
    "Daniel Vladar": 8478435,
    "Drew O'connor": 8482055,
    "Dylan Demelo": 8476331,
    "Dylan Mcilrath": 8475795,
    "Hunter Shepard": 8482411,      # Goalie — excluded from skater RAPM
    "J Compher": 8477456,
    "J Miller": 8476468,
    "J Moser": 8482655,
    "Jack Mcbain": 8480855,
    "Jackson Lacombe": 8481605,
    "Jacob Bernard-docker": 8480879,
    "Jake Debrusk": 8478498,
    "Jake Mccabe": 8476931,
    "Jared Mccann": 8477955,
    "Jean-gabriel Pageau": 8476419,
    "Jiri Patera": 8480238,         # Goalie
    "Jj Peterka": 8482175,
    "John Roslovic": 8478458,
    "Joseph Labate": 8476425,
    "K'andre Miller": 8480817,
    "Kurtis Macdermid": 8477073,
    "Kyle Maclean": 8481237,
    "Liam O'brien": 8477070,
    "Lucas Glendening": 8476822,
    "Mackenzie Maceachern": 8476907,
    "Mackenzie Weegar": 8477346,
    "Mads Sogaard": 8481544,        # Goalie
    "Mason Mctavish": 8482745,
    "Matthew Benning": 8476988,
    "Michael Dipietro": 8480022,    # Goalie
    "Michael Mccarron": 8477446,
    "Mitchell Marner": 8478483,
    "Nathan Mackinnon": 8477492,
    "Nick Desimone": 8480084,
    "Nico Daws": 8482076,           # Goalie — NOT Nic Dowd!
    "Oliver Ekman-larsson": 8475171,
    "Pierre-luc Dubois": 8479400,
    "Pierre-olivier Joseph": 8480058,
    "Rutger Mcgroarty": 8483487,
    "Ryan Mcdonagh": 8474151,
    "Ryan Mcleod": 8480802,
    "Ryan Nugent-hopkins": 8476454,
    "Ryan O'reilly": 8475158,
    "T Tynan": 8476391,
    "Tony Deangelo": 8477950,
    "Ukko-pekka Luukkonen": 8480045,  # Goalie
    "Zach Aston-reese": 8479944,
    "Zachary L'heureux": 8482742,
    "Zack Macewen": 8479772,
}

# ── Configuration ─────────────────────────────────────────────────────────
MIN_STINT_SECONDS = 4.0       # Minimum stint duration (filters line-change noise)
ALPHA_RANGE_FAST = [50, 100, 200]  # Quick alpha grid for development
ALPHA_RANGE_FULL = list(np.logspace(0, 3, 30))  # 1 to 1000, 30 points
PERIOD_MAX = {1: 1200, 2: 1200, 3: 1200, 4: 300, 5: 300}


# ── Step 1: Resolve Player IDs ───────────────────────────────────────────

def _build_goalie_set():
    """Build set of known goalie player IDs from player_stats or MoneyPuck."""
    goalie_ids = set()

    # From player stats
    ps_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_player_stats.csv')
    if os.path.exists(ps_path):
        ps = pd.read_csv(ps_path, usecols=['player_id', 'is_goalie'], low_memory=False)
        goalie_ids.update(
            ps[ps['is_goalie'] == True]['player_id'].dropna().astype(int).tolist()
        )

    # From MoneyPuck (position == 'G')
    mp_path = os.path.join(SCRIPT_DIR, 'moneypuck_skaters.csv')
    if os.path.exists(mp_path):
        mp = pd.read_csv(mp_path, usecols=['playerId', 'position'], low_memory=False)
        goalie_ids.update(
            mp[mp['position'] == 'G']['playerId'].dropna().astype(int).tolist()
        )

    return goalie_ids


def _resolve_player_ids(shifts):
    """
    Fill null player_id values using three-tier resolution:
    1. Numeric player_id already present → use directly
    2. Name→ID mapping from valid shifts + MoneyPuck
    3. Manual RAPM_NAME_OVERRIDES for HTML-scraper formatting issues

    Returns shifts with 'resolved_id' column (int or NaN).
    """
    shifts = shifts.copy()

    # Tier 1: direct numeric IDs
    shifts['resolved_id'] = shifts['player_id'].copy()

    # Build name→ID mapping from valid rows
    valid = shifts[shifts['player_id'].notna()]
    name_to_id = dict(zip(valid['player_name'], valid['player_id'].astype(int)))

    # Add MoneyPuck names
    mp_path = os.path.join(SCRIPT_DIR, 'moneypuck_skaters.csv')
    if os.path.exists(mp_path):
        mp = pd.read_csv(mp_path, usecols=['playerId', 'name'], low_memory=False)
        mp_map = dict(zip(mp['name'], mp['playerId'].astype(int)))
        # Shifts mapping takes priority (more recent/accurate)
        name_to_id = {**mp_map, **name_to_id}

    # Add manual overrides (highest priority)
    for name, pid in RAPM_NAME_OVERRIDES.items():
        name_to_id[name] = pid

    # Tier 2+3: fill nulls from name mapping
    null_mask = shifts['resolved_id'].isna()
    shifts.loc[null_mask, 'resolved_id'] = shifts.loc[null_mask, 'player_name'].map(name_to_id)

    # Convert to int where possible
    shifts['resolved_id'] = pd.to_numeric(shifts['resolved_id'], errors='coerce')

    resolved = shifts['resolved_id'].notna().sum()
    total = len(shifts)
    null_original = null_mask.sum()
    still_null = shifts['resolved_id'].isna().sum()
    print(f"  Player ID resolution: {resolved:,}/{total:,} resolved "
          f"({still_null:,} unresolvable from {null_original:,} originally null)")

    return shifts


# ── Step 2: Build Game Home/Away Lookup ───────────────────────────────────

def _build_game_home_lookup():
    """Returns {game_id: home_team_id} from gamestats."""
    gs_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_gamestats.csv')
    teams_path = os.path.join(SCRIPT_DIR, 'nhl_teams.csv')

    gs = pd.read_csv(gs_path, usecols=['game_id', 'team', 'home_away'], low_memory=False)
    teams = pd.read_csv(teams_path)
    name_to_tid = dict(zip(teams['Common Name'], teams['NHL Team ID'].astype(int)))

    gs['team_id'] = gs['team'].map(name_to_tid)
    home = gs[gs['home_away'] == 'Home'][['game_id', 'team_id']].drop_duplicates()

    return dict(zip(home['game_id'].astype(int), home['team_id'].astype(int)))


# ── Step 3: Build Stints from Shifts ──────────────────────────────────────

def _build_stints(shifts, game_home_lookup, goalie_ids, min_seconds=MIN_STINT_SECONDS):
    """
    Construct 5v5 stints via breakpoint-interval algorithm.

    For each game+period:
    1. Collect all shift start/end times as breakpoints
    2. Between consecutive breakpoints, the on-ice personnel are constant
    3. Determine who's on ice by checking which shifts span the interval
    4. Keep stints with exactly 5 skaters per side

    Returns list of stint dicts.
    """
    # Filter to resolved shifts only
    shifts = shifts[shifts['resolved_id'].notna()].copy()
    shifts['resolved_id'] = shifts['resolved_id'].astype(int)

    # Clamp shift ends to period max
    shifts['end_clamped'] = shifts.apply(
        lambda r: min(r['end_seconds'], PERIOD_MAX.get(r['period'], 1200)),
        axis=1
    )
    # Filter zero/negative duration after clamping
    shifts = shifts[shifts['end_clamped'] > shifts['start_seconds']].copy()

    # Deduplicate shifts
    shifts = shifts.drop_duplicates(
        subset=['game_id', 'period', 'resolved_id', 'start_seconds'],
        keep='first'
    )

    print(f"  Building stints from {len(shifts):,} resolved shifts "
          f"across {shifts['game_id'].nunique()} games...")

    all_stints = []
    skipped_games = 0

    # Group by game+period for efficiency
    grouped = shifts.groupby(['game_id', 'period'])

    for (game_id, period), grp in grouped:
        home_tid = game_home_lookup.get(int(game_id))
        if home_tid is None:
            continue

        # Separate home/away shifts
        grp_home = grp[grp['team_id'] == home_tid]
        grp_away = grp[grp['team_id'] != home_tid]

        if grp_home.empty or grp_away.empty:
            continue

        # Collect all breakpoints (shift starts and ends)
        breakpoints = set()
        for _, row in grp.iterrows():
            breakpoints.add(row['start_seconds'])
            breakpoints.add(row['end_clamped'])
        breakpoints = sorted(breakpoints)

        if len(breakpoints) < 2:
            continue

        # Pre-convert to numpy for faster interval checking
        h_starts = grp_home['start_seconds'].values
        h_ends = grp_home['end_clamped'].values
        h_ids = grp_home['resolved_id'].values.astype(int)

        a_starts = grp_away['start_seconds'].values
        a_ends = grp_away['end_clamped'].values
        a_ids = grp_away['resolved_id'].values.astype(int)

        # Walk consecutive breakpoints
        for i in range(len(breakpoints) - 1):
            bp_start = breakpoints[i]
            bp_end = breakpoints[i + 1]
            duration = bp_end - bp_start

            if duration < min_seconds:
                continue

            # Find players active during entire interval
            # A shift is active if: start <= bp_start AND end >= bp_end
            h_active_mask = (h_starts <= bp_start) & (h_ends >= bp_end)
            a_active_mask = (a_starts <= bp_start) & (a_ends >= bp_end)

            h_on_ice = set(h_ids[h_active_mask])
            a_on_ice = set(a_ids[a_active_mask])

            # Separate goalies from skaters
            h_skaters = h_on_ice - goalie_ids
            a_skaters = a_on_ice - goalie_ids
            h_goalies = h_on_ice & goalie_ids
            a_goalies = a_on_ice & goalie_ids

            # 5v5 filter: exactly 5 skaters per side
            if len(h_skaters) != 5 or len(a_skaters) != 5:
                continue

            all_stints.append({
                'game_id': int(game_id),
                'period': int(period),
                'start': bp_start,
                'end': bp_end,
                'duration': duration,
                'home_skaters': sorted(h_skaters),
                'away_skaters': sorted(a_skaters),
                'home_goalie': min(h_goalies) if h_goalies else None,
                'away_goalie': min(a_goalies) if a_goalies else None,
            })

    print(f"  Built {len(all_stints):,} 5v5 stints")
    return all_stints


# ── Step 4: Attribute Shots to Stints ─────────────────────────────────────

def _attribute_shots_to_stints(stints, shots, game_home_lookup):
    """
    For each stint, sum xGF and xGA from the home team's perspective.
    Uses sorted merge-join for O(n log n) performance.
    """
    # Filter shots to 5v5
    shots_5v5 = shots[shots['strength_state'] == '5v5'].copy()
    shots_5v5['xG'] = pd.to_numeric(shots_5v5['xG'], errors='coerce').fillna(0)
    shots_5v5['team_id'] = shots_5v5['team_id'].astype(int)

    print(f"  Attributing {len(shots_5v5):,} 5v5 shots to stints...")

    # Build shot lookup: (game_id, period) → sorted list of (time, team_id, xG)
    shot_lookup = defaultdict(list)
    for _, row in shots_5v5.iterrows():
        key = (int(row['game_id']), int(row['period']))
        shot_lookup[key].append((row['time_seconds'], int(row['team_id']), row['xG']))

    # Sort each game-period's shots by time
    for key in shot_lookup:
        shot_lookup[key].sort()

    # Attribute shots to stints
    total_xgf = 0.0
    total_xga = 0.0
    shots_attributed = 0

    for stint in stints:
        key = (stint['game_id'], stint['period'])
        game_shots = shot_lookup.get(key, [])
        home_tid = game_home_lookup.get(stint['game_id'])

        xgf = 0.0
        xga = 0.0
        n_shots = 0

        # Binary search for stint start
        start = stint['start']
        end = stint['end']

        for t, tid, xg in game_shots:
            if t < start:
                continue
            if t > end:
                break
            n_shots += 1
            if tid == home_tid:
                xgf += xg
            else:
                xga += xg

        stint['xgf'] = xgf
        stint['xga'] = xga
        stint['n_shots'] = n_shots
        total_xgf += xgf
        total_xga += xga
        shots_attributed += n_shots

    print(f"  Shots attributed: {shots_attributed:,} "
          f"(xGF={total_xgf:.1f}, xGA={total_xga:.1f})")
    return stints


# ── Step 5: Build Sparse Design Matrix ────────────────────────────────────

def _build_design_matrix(stints):
    """
    Build sparse design matrix for ridge regression.

    Each stint = one row.
    Each skater = one column: +1 if home team, -1 if away team, 0 if not on ice.
    Target: xGF/60 (home perspective) for offense, xGA/60 for defense.
    Weights: sqrt(duration) — balances long/short stint influence.

    Returns: (X_sparse, y_off, y_def, weights, player_index)
    """
    from scipy.sparse import lil_matrix, csr_matrix

    # Build player index: all unique skater IDs across all stints
    all_players = set()
    for s in stints:
        all_players.update(s['home_skaters'])
        all_players.update(s['away_skaters'])

    player_list = sorted(all_players)
    player_index = {pid: i for i, pid in enumerate(player_list)}
    n_players = len(player_list)
    n_stints = len(stints)

    print(f"  Design matrix: {n_stints:,} stints × {n_players} skaters")

    # Build sparse matrix
    X = lil_matrix((n_stints, n_players), dtype=np.float32)
    y_off = np.zeros(n_stints, dtype=np.float64)
    y_def = np.zeros(n_stints, dtype=np.float64)
    weights = np.zeros(n_stints, dtype=np.float64)

    for i, stint in enumerate(stints):
        dur = stint['duration']

        # Player encoding
        for pid in stint['home_skaters']:
            X[i, player_index[pid]] = 1.0
        for pid in stint['away_skaters']:
            X[i, player_index[pid]] = -1.0

        # Target: per-60 rates
        rate_mult = 3600.0 / dur if dur > 0 else 0.0
        y_off[i] = stint['xgf'] * rate_mult
        y_def[i] = stint['xga'] * rate_mult

        # Weight: sqrt(duration) — gives some weight to short stints
        # but doesn't let 20-minute stints dominate
        weights[i] = np.sqrt(dur)

    X_csr = csr_matrix(X)

    # Validate: each row should have exactly 10 non-zeros (5 home + 5 away)
    nnz_per_row = np.diff(X_csr.indptr)
    assert (nnz_per_row == 10).all(), \
        f"Expected 10 non-zeros per row, got range [{nnz_per_row.min()}, {nnz_per_row.max()}]"

    print(f"  Matrix density: {X_csr.nnz / (n_stints * n_players):.4%}")
    print(f"  Memory: {X_csr.data.nbytes / 1e6:.1f} MB")

    return X_csr, y_off, y_def, weights, player_index


# ── Step 6: Ridge Regression with CV ──────────────────────────────────────

def _fit_ridge_cv(X, y, weights, alpha_range, label=""):
    """
    Ridge regression with k-fold cross-validation.
    Returns (coefficients, best_alpha, cv_scores).
    """
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import KFold

    best_alpha = None
    best_loss = np.inf
    cv_scores = []

    kf = KFold(n_splits=5, shuffle=True, random_state=42)

    for alpha in alpha_range:
        fold_losses = []
        for train_idx, val_idx in kf.split(X):
            model = Ridge(
                alpha=alpha,
                solver='sparse_cg',
                fit_intercept=True,
                max_iter=5000,
            )
            model.fit(X[train_idx], y[train_idx], sample_weight=weights[train_idx])
            pred = model.predict(X[val_idx])
            residuals = y[val_idx] - pred
            wmse = np.average(residuals**2, weights=weights[val_idx])
            fold_losses.append(wmse)

        mean_loss = np.mean(fold_losses)
        cv_scores.append((alpha, mean_loss))

        if mean_loss < best_loss:
            best_loss = mean_loss
            best_alpha = alpha

    print(f"  {label} Best alpha: {best_alpha:.1f} (wMSE={best_loss:.4f})")

    # Fit final model on all data
    final_model = Ridge(
        alpha=best_alpha,
        solver='sparse_cg',
        fit_intercept=True,
        max_iter=5000,
    )
    final_model.fit(X, y, sample_weight=weights)

    return final_model.coef_, best_alpha, cv_scores


# ── Step 7: Compute TOI per Player ────────────────────────────────────────

def _compute_player_toi(stints, player_index):
    """Compute total 5v5 TOI in seconds per player from stints."""
    toi = np.zeros(len(player_index))
    stint_counts = np.zeros(len(player_index), dtype=int)

    for stint in stints:
        dur = stint['duration']
        for pid in stint['home_skaters'] + stint['away_skaters']:
            idx = player_index.get(pid)
            if idx is not None:
                toi[idx] += dur
                stint_counts[idx] += 1

    return toi, stint_counts


# ── Main Entry Point ──────────────────────────────────────────────────────

def run_rapm(fast=False):
    """
    Full RAPM pipeline: shifts + shots → ridge regression → rapm_scores.json.

    Args:
        fast: If True, use smaller alpha grid (development mode).

    Returns: dict of {player_id_str: {rapm_off, rapm_def, rapm_net, ...}}
    """
    t0 = time.time()
    print("\n--- RAPM Player Isolation ---")

    # Load data
    shifts_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_shifts.csv')
    shots_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_shots.csv')

    shifts = pd.read_csv(shifts_path, low_memory=False)
    shots = pd.read_csv(shots_path, low_memory=False)

    print(f"  Loaded {len(shifts):,} shifts, {len(shots):,} shots")

    # Step 1: Resolve player IDs
    shifts = _resolve_player_ids(shifts)

    # Build goalie set (to separate from skaters)
    goalie_ids = _build_goalie_set()
    print(f"  Known goalies: {len(goalie_ids)}")

    # Step 2: Game home/away lookup
    game_home = _build_game_home_lookup()

    # Step 3: Build stints
    stints = _build_stints(shifts, game_home, goalie_ids)

    if len(stints) < 1000:
        print(f"  [WARN] Only {len(stints)} stints — insufficient for RAPM")
        return {}

    # Step 4: Attribute shots
    stints = _attribute_shots_to_stints(stints, shots, game_home)

    # Step 5: Build design matrix
    X, y_off, y_def, weights, player_index = _build_design_matrix(stints)

    # Step 6: Ridge regression
    alpha_range = ALPHA_RANGE_FAST if fast else ALPHA_RANGE_FULL
    print(f"\n  Fitting ridge regression ({'fast' if fast else 'full'} CV, "
          f"{len(alpha_range)} alphas × 5 folds × 2 models)...")

    coef_off, alpha_off, _ = _fit_ridge_cv(X, y_off, weights, alpha_range, "Offense")
    coef_def, alpha_def, _ = _fit_ridge_cv(X, y_def, weights, alpha_range, "Defense")

    # Step 7: Compute TOI and build output
    toi, stint_counts = _compute_player_toi(stints, player_index)

    # Build results dict
    results = {}
    player_list = sorted(player_index.keys(), key=lambda pid: player_index[pid])

    for pid in player_list:
        idx = player_index[pid]
        rapm_off = float(coef_off[idx])
        rapm_def = float(coef_def[idx])
        rapm_net = rapm_off - rapm_def  # Net = offense minus defense (lower defense is better)
        player_toi = float(toi[idx])
        player_stints = int(stint_counts[idx])

        results[str(pid)] = {
            'rapm_off': round(rapm_off, 4),
            'rapm_def': round(rapm_def, 4),
            'rapm_net': round(rapm_net, 4),
            'rapm_toi': round(player_toi, 0),
            'rapm_stints': player_stints,
        }

    # Save
    out_path = os.path.join(SCRIPT_DIR, 'rapm_scores.json')
    with open(out_path, 'w') as f:
        json.dump(results, f, indent=2)

    elapsed = time.time() - t0
    print(f"\n  RAPM complete: {len(results)} players, "
          f"alpha_off={alpha_off:.1f}, alpha_def={alpha_def:.1f}")
    print(f"  Saved to {os.path.basename(out_path)} ({elapsed:.1f}s)")

    # Diagnostics
    _print_diagnostics(results, player_index, coef_off, coef_def)

    return results


def _print_diagnostics(results, player_index, coef_off, coef_def):
    """Print top/bottom players and validation checks."""
    # Load names for display
    mp_path = os.path.join(SCRIPT_DIR, 'moneypuck_skaters.csv')
    id_to_name = {}
    if os.path.exists(mp_path):
        mp = pd.read_csv(mp_path, usecols=['playerId', 'name'], low_memory=False)
        id_to_name = dict(zip(mp['playerId'].astype(int).astype(str), mp['name']))

    # Also try player stats
    ps_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_player_stats.csv')
    if os.path.exists(ps_path):
        ps = pd.read_csv(ps_path, usecols=['player_id', 'name'], low_memory=False)
        ps_map = dict(zip(ps['player_id'].dropna().astype(int).astype(str),
                          ps['name']))
        id_to_name = {**ps_map, **id_to_name}

    # Filter to players with meaningful TOI (>5000s = ~83 min)
    meaningful = {k: v for k, v in results.items() if v['rapm_toi'] >= 5000}

    # Top offensive
    top_off = sorted(meaningful.items(), key=lambda x: x[1]['rapm_off'], reverse=True)[:10]
    print(f"\n  Top 10 Offensive RAPM (>83 min 5v5 TOI):")
    for pid, data in top_off:
        name = id_to_name.get(pid, f"ID:{pid}")
        print(f"    {name:25s} OFF={data['rapm_off']:+.3f}  "
              f"DEF={data['rapm_def']:+.3f}  NET={data['rapm_net']:+.3f}  "
              f"TOI={data['rapm_toi']/60:.0f}min")

    # Top defensive (lowest xGA/60 = best)
    top_def = sorted(meaningful.items(), key=lambda x: x[1]['rapm_def'])[:10]
    print(f"\n  Top 10 Defensive RAPM (lowest xGA/60):")
    for pid, data in top_def:
        name = id_to_name.get(pid, f"ID:{pid}")
        print(f"    {name:25s} DEF={data['rapm_def']:+.3f}  "
              f"OFF={data['rapm_off']:+.3f}  NET={data['rapm_net']:+.3f}  "
              f"TOI={data['rapm_toi']/60:.0f}min")

    # Zero-sum check: mean of all coefficients should be near 0
    mean_off = np.mean(coef_off)
    mean_def = np.mean(coef_def)
    print(f"\n  Zero-sum check: mean_off={mean_off:.4f}, mean_def={mean_def:.4f} "
          f"(should be near 0)")


# ── CLI ───────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    os.chdir(SCRIPT_DIR)

    fast = '--fast' in sys.argv
    results = run_rapm(fast=fast)

    if results:
        print(f"\n✅ RAPM complete: {len(results)} player ratings computed.")
    else:
        print("\n❌ RAPM failed — check data availability.")
