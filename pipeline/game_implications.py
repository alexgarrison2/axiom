"""
game_implications.py
====================
Computes playoff-probability implications for each of today's upcoming games.

For every game, runs 4 forced-outcome scenarios (home reg win, home OT win,
away OT win, away reg win), each with N_SIMS Monte Carlo season simulations.

Outputs public/data/game_implications.json consumed by the frontend MatchupCard.

Run order: AFTER season_simulator.py (needs season_projections.json as baseline).
"""

import json
import os
import sys
import random
import shutil
import datetime

# Reuse helpers from season_simulator.py (same directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from season_simulator import (
    fetch_current_standings,
    fetch_remaining_schedule,
    build_team_map,
    determine_standings,
    get_game_prob,
    load_json,
    load_csv,
)

# Fewer sims than full season_simulator — directionally accurate, fast enough
N_SIMS = 1500


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def simulate_season_forced(base_standings, schedule, ratings, team_map,
                            forced_game_id, forced_outcome):
    """
    Like season_simulator.simulate_season() but forces a specific game's result.

    forced_outcome one of:
        'home_reg_win' — Home wins in regulation (Home +2pts, Away +0)
        'home_otw'     — Home wins in OT          (Home +2pts, Away +1 OTL)
        'away_otw'     — Away wins in OT          (Away +2pts, Home +1 OTL)
        'away_reg_win' — Away wins in regulation  (Away +2pts, Home +0)
    """
    current = {k: v.copy() for k, v in base_standings.items()}
    forced_id_str = str(forced_game_id)

    for game in schedule:
        h = game['home']
        a = game['away']

        if str(game.get('id', '')) == forced_id_str:
            # Apply forced result
            if forced_outcome == 'home_reg_win':
                current[h]['pts'] += 2
                current[h]['w']   += 1
                current[h]['rw']  += 1
                current[h]['row'] += 1
                current[a]['l']   += 1
            elif forced_outcome == 'away_reg_win':
                current[a]['pts'] += 2
                current[a]['w']   += 1
                current[a]['rw']  += 1
                current[a]['row'] += 1
                current[h]['l']   += 1
            elif forced_outcome == 'home_otw':
                current[h]['pts'] += 2
                current[h]['w']   += 1
                current[h]['row'] += 1
                current[a]['pts'] += 1
                current[a]['otl'] += 1
            elif forced_outcome == 'away_otw':
                current[a]['pts'] += 2
                current[a]['w']   += 1
                current[a]['row'] += 1
                current[h]['pts'] += 1
                current[h]['otl'] += 1
        else:
            # Normal probabilistic simulation (mirrors season_simulator logic)
            h_name = team_map.get(h)
            a_name = team_map.get(a)
            def_rating = {'xgf_rating': 3.0, 'xga_rating': 3.0}
            h_r = ratings.get(h_name, def_rating)
            a_r = ratings.get(a_name, def_rating)

            p_h_reg, p_a_reg, p_ot, raw_h = get_game_prob(h_r, a_r)
            r = random.random()

            if r < p_h_reg:
                current[h]['pts'] += 2
                current[h]['w']   += 1
                current[h]['rw']  += 1
                current[h]['row'] += 1
                current[a]['l']   += 1
            elif r < (p_h_reg + p_a_reg):
                current[a]['pts'] += 2
                current[a]['w']   += 1
                current[a]['rw']  += 1
                current[a]['row'] += 1
                current[h]['l']   += 1
            else:
                # OT — both get 1 pt, then decide winner
                current[h]['pts'] += 1
                current[a]['pts'] += 1
                current[h]['otl'] += 1
                current[a]['otl'] += 1
                if random.random() < raw_h:
                    current[h]['pts'] += 1
                    current[h]['w']   += 1
                    current[h]['row'] += 1
                    current[h]['otl'] -= 1
                else:
                    current[a]['pts'] += 1
                    current[a]['w']   += 1
                    current[a]['row'] += 1
                    current[a]['otl'] -= 1

    return current


def get_playoff_teams(divs, east, west):
    """Return set of tricodes for the 16 teams that made the playoffs."""
    atl_top3 = divs.get('A', [])[:3]
    met_top3 = divs.get('M', [])[:3]
    top3_east = set(x[0] for x in atl_top3 + met_top3)
    east_wc = [x for x in east if x[0] not in top3_east][:2]

    cen_top3 = divs.get('C', [])[:3]
    pac_top3 = divs.get('P', [])[:3]
    top3_west = set(x[0] for x in cen_top3 + pac_top3)
    west_wc = [x for x in west if x[0] not in top3_west][:2]

    return set(
        x[0] for x in atl_top3 + met_top3 + east_wc + cen_top3 + pac_top3 + west_wc
    )


def run_scenario_sims(base_standings, schedule, ratings, team_map,
                       forced_game_id, forced_outcome, n_sims=N_SIMS):
    """
    Run n_sims simulations with a forced game result.
    Returns (playoff_pcts_dict, avg_pts_dict) keyed by team tricode.
    """
    made_playoffs = {abbr: 0 for abbr in base_standings}
    total_pts     = {abbr: 0 for abbr in base_standings}

    for _ in range(n_sims):
        final = simulate_season_forced(
            base_standings, schedule, ratings, team_map,
            forced_game_id, forced_outcome
        )
        divs, east, west = determine_standings(final)
        playoff_teams = get_playoff_teams(divs, east, west)

        for abbr in base_standings:
            if abbr in playoff_teams:
                made_playoffs[abbr] += 1
            total_pts[abbr] += final[abbr]['pts']

    playoff_pcts = {
        abbr: round(made_playoffs[abbr] / n_sims * 100, 1)
        for abbr in base_standings
    }
    avg_pts = {
        abbr: round(total_pts[abbr] / n_sims, 1)
        for abbr in base_standings
    }
    return playoff_pcts, avg_pts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def compute_game_implications():
    print(f"[game_implications] Starting — {N_SIMS} sims per scenario...")

    # 1. Shared data (same fetches as season_simulator)
    schedule          = fetch_remaining_schedule()
    team_ratings      = load_json(os.path.join(SCRIPT_DIR, 'team_ratings.json'))
    nhl_teams         = load_csv(os.path.join(SCRIPT_DIR, 'nhl_teams.csv'))
    team_map          = build_team_map(nhl_teams)
    current_standings = fetch_current_standings()

    # 2. Baseline playoff %s from season_projections.json (already run by season_simulator)
    proj_path = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'season_projections.json')
    if not os.path.exists(proj_path):
        print("[game_implications] WARN: season_projections.json not found — skipping.")
        return

    season_projs    = load_json(proj_path)
    baseline_by_team = {t['team']: t for t in season_projs['teams']}

    # 3. Today's games from upcoming_games.json
    upcoming_path = os.path.join(SCRIPT_DIR, 'upcoming_games.json')
    if not os.path.exists(upcoming_path):
        print("[game_implications] WARN: upcoming_games.json not found — skipping.")
        return

    today   = datetime.date.today().isoformat()
    upcoming = load_json(upcoming_path)
    today_games = [g for g in upcoming if g.get('gameDate', '') == today]

    if not today_games:
        print(f"[game_implications] No games for {today} — writing empty output.")
        _write_output({'generated_at': datetime.datetime.now().isoformat(), 'games': []})
        return

    # Build a set of IDs that appear in the remaining schedule
    schedule_ids = {str(g['id']) for g in schedule if 'id' in g}

    OUTCOMES = ['home_reg_win', 'home_otw', 'away_otw', 'away_reg_win']
    game_results = []

    for game in today_games:
        game_id      = str(game.get('id', ''))
        home_abbrev  = game.get('homeTeamAbbrev', '')
        away_abbrev  = game.get('awayTeamAbbrev', '')

        print(f"  {away_abbrev} @ {home_abbrev}  (id={game_id})")

        if game_id not in schedule_ids:
            print(f"    WARN: id {game_id} not in remaining schedule — skipping.")
            continue

        home_baseline = baseline_by_team.get(home_abbrev, {})
        away_baseline = baseline_by_team.get(away_abbrev, {})

        scenarios = {}
        for outcome in OUTCOMES:
            print(f"    → {outcome} ...", end=' ', flush=True)
            pcts, pts = run_scenario_sims(
                current_standings, schedule, team_ratings, team_map,
                game_id, outcome
            )
            scenarios[outcome] = {
                'home_playoff_pct': pcts.get(home_abbrev),
                'away_playoff_pct': pcts.get(away_abbrev),
                'home_avg_pts':     pts.get(home_abbrev),
                'away_avg_pts':     pts.get(away_abbrev),
            }
            print("done")

        game_results.append({
            'game_id':                   int(game_id),
            'date':                      game.get('gameDate', today),
            'home_abbrev':               home_abbrev,
            'away_abbrev':               away_abbrev,
            'home_current_playoff_pct':  home_baseline.get('make_playoffs_pct'),
            'away_current_playoff_pct':  away_baseline.get('make_playoffs_pct'),
            'home_current_avg_pts':      home_baseline.get('avg_points'),
            'away_current_avg_pts':      away_baseline.get('avg_points'),
            'scenarios':                 scenarios,
        })

    output = {
        'generated_at': datetime.datetime.now().isoformat(),
        'games':        game_results,
    }
    _write_output(output)
    print(f"[game_implications] Done — {len(game_results)} games written.")


def _write_output(output):
    # Write to pipeline/ (local copy)
    local_path = os.path.join(SCRIPT_DIR, 'game_implications.json')
    with open(local_path, 'w') as f:
        json.dump(output, f, indent=2)

    # Copy to public/data/ for the Next.js frontend
    public_path = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'game_implications.json')
    shutil.copy2(local_path, public_path)
    print(f"  Written → {public_path}")


if __name__ == '__main__':
    compute_game_implications()
