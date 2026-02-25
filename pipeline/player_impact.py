"""
player_impact.py

Transforms MoneyPuck per-player statistics into lineup-ready impact scores
for use in game prediction.

For each player (5v5, PP, PK, all-situations) this module calculates:

  EV (5v5):
    relative_xgf_pct    On-ice xGF% minus off-ice xGF% — best single proxy
                        for isolated individual impact; positive = team is
                        better when player is on the ice.
    ev_xgf_per60        On-ice xGoals For per 60 min at even strength
    ev_xga_per60        On-ice xGoals Against per 60 min at even strength
    ev_net_per60        xGF/60 − xGA/60 (positive = net positive player)
    ind_xg_per60        Individual expected goals per 60 (shooting threat)
    ind_hd_xg_per60     Individual high-danger xGoals per 60

  Special teams:
    pp_xgf_per60        On-ice xGoals For per 60 on the PP (5on4)
    pk_xga_per60        On-ice xGoals Against per 60 on the PK (4on5)

  Context:
    penalty_diff_per60  (Drawn − Taken) per 60 (positive = penalty-drawer)
    game_score          MoneyPuck's all-in-one rating

Output files (written to pipeline/):
  player_impact.json       — {playerId: impact_dict} for prediction engine
  league_avg_impact.json   — league-average baselines by position group
  player_name_lookup.json  — normalized name → playerId  (DFO name matching)

  Also synced to public/data/player_impact.json for optional frontend use.

Usage:
  python player_impact.py                          # standalone
  from player_impact import calculate_player_impact  # in pipeline
"""

import os
import json
import re
import numpy as np
import pandas as pd

# ── Constants ─────────────────────────────────────────────────────────────────

# Players with less than this many 5v5 seconds on the season are excluded.
# 1800s = 30 minutes total = ~3 min/gm over 10 games — weeds out deep recalls.
MIN_EV_TOI_SECONDS = 1800    # 30 minutes total — minimum for a profile

# Min ice time per game to be considered "active" in lineup projection
MIN_EV_TOI_PER_GAME = 120    # 2 minutes per game

# Min PP/PK TOI to generate valid special-teams rates
MIN_ST_TOI_SECONDS = 120     # 2 minutes total on PP or PK

# Bayesian shrinkage anchor for relative_xgf_pct (seconds of 5v5 TOI).
# A player with this many seconds gets 50% regression toward league average.
# 18,000 seconds ≈ 300 minutes ≈ typical top-6 F full season.
# Small-sample players are pulled strongly toward 0; stars barely affected.
RELATIVE_SHRINKAGE_ANCHOR = 18000   # seconds

# ── Name normalisation ────────────────────────────────────────────────────────

_ACCENT_MAP = str.maketrans(
    "éèêëáàâíïóöôúüûýšžčňř",
    "eeeeaaaiiooouuuyszcnr"
)

def normalize_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    if not name:
        return ""
    return name.lower().translate(_ACCENT_MAP).strip()

# ── Math helpers ──────────────────────────────────────────────────────────────

def per60(numerator: float, toi_seconds: float) -> float:
    """Convert a counting stat to a per-60-minute rate. Returns 0 if TOI < 1s."""
    return (numerator / toi_seconds) * 3600.0 if toi_seconds >= 1 else 0.0


def _safe_float(val, default=0.0) -> float:
    try:
        v = float(val)
        return v if np.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def _avg(records: list, key: str) -> float:
    vals = [_safe_float(r.get(key)) for r in records if r.get(key) is not None]
    return round(float(np.mean(vals)), 4) if vals else 0.0

# ── Core calculation ──────────────────────────────────────────────────────────

def calculate_player_impact(
    skater_file: str = "moneypuck_skaters.csv",
    output_file: str = "player_impact.json",
    league_avg_file: str = "league_avg_impact.json",
    lookup_file: str = "player_name_lookup.json",
) -> tuple:
    """
    Compute per-player impact metrics from MoneyPuck skater data.

    Returns:
        (player_impact dict, league_avgs dict)
        Keys in player_impact: str(playerId)
    """
    print("=== Calculating Player Impact Metrics ===")

    # ── Load data ──
    if not os.path.exists(skater_file):
        print(f"  ERROR: {skater_file} not found. Run fetch_moneypuck.py first.")
        return {}, {}

    df_raw = pd.read_csv(skater_file)
    print(f"  Loaded {len(df_raw)} rows from {skater_file}")

    # Validate critical columns exist
    required = ['playerId', 'name', 'position', 'situation', 'icetime', 'games_played',
                'OnIce_F_xGoals', 'OnIce_A_xGoals',
                'onIce_xGoalsPercentage', 'offIce_xGoalsPercentage',
                'I_F_xGoals']
    missing = [c for c in required if c not in df_raw.columns]
    if missing:
        print(f"  [WARN] Missing columns: {missing}")
        print(f"  Available: {list(df_raw.columns)[:40]}")

    # ── Slice by situation ──
    def slice_situation(sit):
        mask = df_raw['situation'] == sit
        slc = df_raw[mask].copy()
        # Build index {str(playerId): row_Series}
        return {str(r['playerId']): r for _, r in slc.iterrows()} if 'playerId' in slc.columns else {}

    idx_5v5 = slice_situation('5on5')
    idx_pp  = slice_situation('5on4')
    idx_pk  = slice_situation('4on5')
    idx_all = slice_situation('all')

    print(f"  Situations — 5v5: {len(idx_5v5)}  PP: {len(idx_pp)}  PK: {len(idx_pk)}  All: {len(idx_all)}")

    if not idx_5v5:
        print("  ERROR: No 5v5 rows. Check situation column values.")
        return {}, {}

    # ── Build per-player impact profiles ──
    player_impact = {}

    for pid, row in idx_5v5.items():

        # ── EV basics ──
        gp      = max(int(_safe_float(row.get('games_played'), 1)), 1)
        ev_toi  = _safe_float(row.get('icetime'))           # seconds at 5v5

        if ev_toi < MIN_EV_TOI_SECONDS:
            continue                                         # too small a sample

        ev_toi_per_game = ev_toi / gp

        # Position (MoneyPuck: 'L','R','C','D','G')
        pos_raw = str(row.get('position', 'F')).upper()
        is_forward = pos_raw in ('L', 'R', 'C', 'F', 'LW', 'RW')

        name  = str(row.get('name', ''))
        team  = str(row.get('team', row.get('team_abbrev', '')))

        # ── On-ice / off-ice xGF% ──
        onice_pct  = _safe_float(row.get('onIce_xGoalsPercentage'),  0.5)
        office_pct = _safe_float(row.get('offIce_xGoalsPercentage'), 0.5)
        raw_relative = onice_pct - office_pct   # + = player helps team

        # Bayesian shrinkage: regress toward 0 for small samples.
        # shrink_weight = TOI / (TOI + ANCHOR), so:
        #   heavy regression when TOI << ANCHOR  (noisy, few minutes)
        #   light regression when TOI >> ANCHOR  (reliable, full-season stars)
        shrink_weight     = ev_toi / (ev_toi + RELATIVE_SHRINKAGE_ANCHOR)
        relative_xgf_pct  = raw_relative * shrink_weight

        # ── On-ice xG rates at EV ──
        onice_xgf = _safe_float(row.get('OnIce_F_xGoals'))
        onice_xga = _safe_float(row.get('OnIce_A_xGoals'))
        ev_xgf_per60 = per60(onice_xgf, ev_toi)
        ev_xga_per60 = per60(onice_xga, ev_toi)
        ev_net_per60 = ev_xgf_per60 - ev_xga_per60

        # ── Individual xG (scoring threat) ──
        i_xg        = _safe_float(row.get('I_F_xGoals'))
        i_xg_flurry = _safe_float(row.get('I_F_flurryAdjustedxGoals'), i_xg)
        i_hd_xg     = _safe_float(row.get('I_F_highDangerxGoals'))
        ind_xg_per60    = per60(i_xg_flurry, ev_toi)
        ind_hd_xg_per60 = per60(i_hd_xg, ev_toi)

        # ── PP (5on4) ──
        pp_toi_per_game = 0.0
        pp_xgf_per60    = 0.0
        if pid in idx_pp:
            r_pp    = idx_pp[pid]
            pp_toi  = _safe_float(r_pp.get('icetime'))
            pp_toi_per_game = pp_toi / gp
            if pp_toi >= MIN_ST_TOI_SECONDS:
                pp_xgf_per60 = per60(_safe_float(r_pp.get('OnIce_F_xGoals')), pp_toi)

        # ── PK (4on5) ──
        pk_toi_per_game = 0.0
        pk_xga_per60    = 0.0
        if pid in idx_pk:
            r_pk    = idx_pk[pid]
            pk_toi  = _safe_float(r_pk.get('icetime'))
            pk_toi_per_game = pk_toi / gp
            if pk_toi >= MIN_ST_TOI_SECONDS:
                pk_xga_per60 = per60(_safe_float(r_pk.get('OnIce_A_xGoals')), pk_toi)

        # ── All-situations: game score & penalty diff ──
        game_score         = 0.0
        penalty_diff_per60 = 0.0
        if pid in idx_all:
            r_all    = idx_all[pid]
            all_toi  = _safe_float(r_all.get('icetime'), ev_toi)
            game_score = _safe_float(r_all.get('gameScore'))
            drawn  = _safe_float(r_all.get('penaltiesDrawn'))
            taken  = _safe_float(r_all.get('penalties'))
            penalty_diff_per60 = per60(drawn - taken, all_toi) if all_toi > 0 else 0.0

        # ── Store profile ──
        player_impact[pid] = {
            'name':     name,
            'team':     team,
            'position': pos_raw,
            'is_forward': is_forward,
            'games_played': gp,

            # Ice time
            'ev_toi_per_game': round(ev_toi_per_game, 1),
            'pp_toi_per_game': round(pp_toi_per_game, 1),
            'pk_toi_per_game': round(pk_toi_per_game, 1),

            # ★ Core isolation metric (Bayesian-shrunken toward 0 for small samples)
            'relative_xgf_pct': round(relative_xgf_pct, 4),
            'raw_relative_xgf_pct': round(raw_relative, 4),  # unshrunken (for inspection)
            'onice_xgf_pct':    round(onice_pct, 4),
            'shrink_weight':    round(shrink_weight, 3),

            # EV rates
            'ev_xgf_per60': round(ev_xgf_per60, 4),
            'ev_xga_per60': round(ev_xga_per60, 4),
            'ev_net_per60': round(ev_net_per60, 4),

            # Individual
            'ind_xg_per60':    round(ind_xg_per60, 4),
            'ind_hd_xg_per60': round(ind_hd_xg_per60, 4),

            # Special teams
            'pp_xgf_per60': round(pp_xgf_per60, 4),
            'pk_xga_per60': round(pk_xga_per60, 4),

            # Context
            'penalty_diff_per60': round(penalty_diff_per60, 4),
            'game_score':         round(game_score, 3),
        }

    print(f"  Built profiles for {len(player_impact)} players (after min-TOI filter)")

    # ── League-average baselines by position group ──
    fwd_profiles = [v for v in player_impact.values() if v['is_forward']]
    def_profiles = [v for v in player_impact.values() if not v['is_forward']]

    league_avgs = {
        # Forwards
        'fwd_ev_xgf_per60':    _avg(fwd_profiles, 'ev_xgf_per60'),
        'fwd_ev_xga_per60':    _avg(fwd_profiles, 'ev_xga_per60'),
        'fwd_ev_net_per60':    _avg(fwd_profiles, 'ev_net_per60'),
        'fwd_ind_xg_per60':    _avg(fwd_profiles, 'ind_xg_per60'),
        'fwd_relative_xgf_pct': _avg(fwd_profiles, 'relative_xgf_pct'),

        # Defensemen
        'def_ev_xgf_per60':    _avg(def_profiles, 'ev_xgf_per60'),
        'def_ev_xga_per60':    _avg(def_profiles, 'ev_xga_per60'),
        'def_ev_net_per60':    _avg(def_profiles, 'ev_net_per60'),
        'def_ind_xg_per60':    _avg(def_profiles, 'ind_xg_per60'),
        'def_relative_xgf_pct': _avg(def_profiles, 'relative_xgf_pct'),

        # All skaters
        'all_ev_xgf_per60': _avg(list(player_impact.values()), 'ev_xgf_per60'),
        'all_ev_xga_per60': _avg(list(player_impact.values()), 'ev_xga_per60'),
    }

    # ── League-average lineup baseline (for ratio-based blending) ──────────────
    # This is what estimate_lineup_xg returns for a team of perfectly average
    # players — used in predict_games.py to compute a dimensionless quality ratio.
    # Formula: sum over lines of (avg_position_rate × line_toi_hours × 1_line_unit)
    fwd_rate = league_avgs['fwd_ev_xgf_per60']
    def_rate = league_avgs['def_ev_xgf_per60']
    fwd_xga  = league_avgs['fwd_ev_xga_per60']
    def_xga  = league_avgs['def_ev_xga_per60']

    _line_toi = {'f1': 5.2, 'f2': 4.5, 'f3': 3.8, 'f4': 3.0,
                 'd1': 5.5, 'd2': 4.5, 'd3': 3.5}

    league_lineup_xgf = sum(
        (fwd_rate if k.startswith('f') else def_rate) * (v / 60.0)
        for k, v in _line_toi.items()
    )
    league_lineup_xga = sum(
        (fwd_xga if k.startswith('f') else def_xga) * (v / 60.0)
        for k, v in _line_toi.items()
    )

    league_avgs['league_lineup_xgf'] = round(league_lineup_xgf, 4)
    league_avgs['league_lineup_xga'] = round(league_lineup_xga, 4)

    print(f"  League avg lineup  xGF/game={league_lineup_xgf:.3f}  xGA/game={league_lineup_xga:.3f}  (used for ratio-blend normalisation)")

    print(f"  League avg fwd  xGF/60={league_avgs['fwd_ev_xgf_per60']:.3f}  xGA/60={league_avgs['fwd_ev_xga_per60']:.3f}  relative={league_avgs['fwd_relative_xgf_pct']:.3f}%")
    print(f"  League avg def  xGF/60={league_avgs['def_ev_xgf_per60']:.3f}  xGA/60={league_avgs['def_ev_xga_per60']:.3f}  relative={league_avgs['def_relative_xgf_pct']:.3f}%")

    # ── Name lookup for DailyFaceoff matching ──
    # DFO stores full player names. We build:
    #   by_full_name: {normalized_full_name → playerId}
    #   by_last_name: {normalized_last_name → [{pid, full_name, team}]}
    name_to_pid   = {}
    last_name_idx = {}   # last_name → list of {pid, full_name, team}

    for pid, data in player_impact.items():
        norm = normalize_name(data['name'])
        name_to_pid[norm] = pid

        parts = norm.split()
        if parts:
            last = parts[-1]
            last_name_idx.setdefault(last, []).append({
                'pid': pid,
                'full_name': norm,
                'team': data['team'],
            })

    # ── Save outputs ──
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    public_data = os.path.join(script_dir, '..', 'public', 'data')

    def _save(data, path):
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)

    # player_impact.json
    local_impact = os.path.join(script_dir, output_file)
    _save(player_impact, local_impact)
    print(f"  ✓ {output_file} ({len(player_impact)} players)")

    # league_avg_impact.json
    local_avg = os.path.join(script_dir, league_avg_file)
    _save(league_avgs, local_avg)
    print(f"  ✓ {league_avg_file}")

    # player_name_lookup.json
    local_lookup = os.path.join(script_dir, lookup_file)
    _save({'by_full_name': name_to_pid, 'by_last_name': last_name_idx}, local_lookup)
    print(f"  ✓ {lookup_file} ({len(name_to_pid)} name entries)")

    # Sync to public/data for optional frontend consumption
    try:
        if os.path.exists(public_data):
            import shutil
            shutil.copy(local_impact, os.path.join(public_data, output_file))
            shutil.copy(local_avg,    os.path.join(public_data, league_avg_file))
            print(f"  ✓ Synced to public/data/")
    except Exception as e:
        print(f"  [WARN] public/data sync failed: {e}")

    print("=== Player Impact Calculation Complete ===\n")
    return player_impact, league_avgs


# ── Lookup helpers (used by predict_games.py) ─────────────────────────────────

def load_player_impact(script_dir: str = None) -> tuple:
    """
    Load pre-computed player_impact.json and league_avg_impact.json.

    Returns:
        (player_impact dict, league_avgs dict)
        Both empty dicts on failure — caller should degrade gracefully.
    """
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))

    pi_path = os.path.join(script_dir, 'player_impact.json')
    la_path = os.path.join(script_dir, 'league_avg_impact.json')
    lu_path = os.path.join(script_dir, 'player_name_lookup.json')

    try:
        with open(pi_path) as f:
            player_impact = json.load(f)
    except FileNotFoundError:
        print("  [WARN] player_impact.json not found — lineup adjustment disabled.")
        return {}, {}, {}
    except Exception as e:
        print(f"  [WARN] Could not load player_impact.json: {e}")
        return {}, {}, {}

    try:
        with open(la_path) as f:
            league_avgs = json.load(f)
    except Exception:
        league_avgs = {}

    try:
        with open(lu_path) as f:
            name_lookup = json.load(f)
    except Exception:
        name_lookup = {}

    return player_impact, league_avgs, name_lookup


def lookup_player(player_id, player_name: str,
                  player_impact: dict, name_lookup: dict) -> dict:
    """
    Find a player's impact profile by player ID or name.

    NOTE on player_id: DailyFaceoff lineup data uses DFO's own internal player
    IDs (e.g. 2781 for Hischier), NOT NHL API player IDs (e.g. 8480002).
    MoneyPuck uses NHL API player IDs as keys in player_impact.  As a result,
    the ID path below will almost never find a match for DFO-sourced lineups.
    Name-based matching (steps 2-3) is the reliable primary path in practice.
    The ID path is retained as a forward-compatibility hook in case a future
    data source provides true NHL player IDs.

    Args:
        player_id:     Player ID (int or str). For DFO lineups this is DFO's
                       internal ID, not the NHL player ID — name lookup is used
                       as the reliable fallback.
        player_name:   Full player name string (primary match path for DFO data)
        player_impact: {str(nhlPlayerId): impact_dict}
        name_lookup:   {'by_full_name': {...}, 'by_last_name': {...}}

    Returns:
        impact dict or None if not found
    """
    # 1. Try by player ID — only succeeds if caller passes an NHL API player ID.
    #    DFO lineup IDs are internal and will NOT match MoneyPuck's NHL player IDs.
    if player_id:
        hit = player_impact.get(str(player_id))
        if hit:
            return hit

    # 2. Fallback: normalised full name
    if player_name:
        norm = normalize_name(player_name)
        pid  = name_lookup.get('by_full_name', {}).get(norm)
        if pid and pid in player_impact:
            return player_impact[pid]

        # 3. Last-name + first-initial (handles abbreviation differences)
        parts = norm.split()
        if len(parts) >= 2:
            last = parts[-1]
            candidates = name_lookup.get('by_last_name', {}).get(last, [])
            if len(candidates) == 1:
                pid = candidates[0]['pid']
                return player_impact.get(pid)
            # Multiple candidates: match first initial
            first_init = parts[0][0] if parts[0] else ''
            for cand in candidates:
                cand_parts = cand['full_name'].split()
                if cand_parts and cand_parts[0].startswith(first_init):
                    return player_impact.get(cand['pid'])

    return None


# ── Lineup-to-xG estimation (used directly by predict_games.py) ──────────────

# Typical 5v5 TOI per line per game (minutes) — based on NHL averages
# ~30 total 5v5 minutes per team per game
_LINE_TOI = {
    'f1': 5.2,   # top line       (~15.6 min combined per line)
    'f2': 4.5,   # second line
    'f3': 3.8,   # third line
    'f4': 3.0,   # fourth line
    'd1': 5.5,   # top pair       (~11.0 min combined per pair)
    'd2': 4.5,   # second pair
    'd3': 3.5,   # third pair
}

# Minimum players matched in lineup to trust lineup estimate
MIN_LINEUP_MATCHES = 5


def estimate_lineup_xg(
    lineup: dict,
    player_impact: dict,
    league_avgs: dict,
    name_lookup: dict,
) -> dict:
    """
    Estimate a team's expected 5v5 xGF/game and xGA/game from the projected lineup.

    KEY DESIGN NOTE — per-line average, not per-player sum:
    ev_xgf_per60 is an ON-ICE rate: it measures the *team's* xGF output while
    that specific player is on the ice.  When three forwards share a line they
    all play the same minutes and thus all measure the same underlying events.
    Summing three players' rates would triple-count those events.  Instead we:
      1. Collect each player's rate for a given line.
      2. Average those rates across the line (all on ice simultaneously).
      3. Multiply the averaged rate by the line's TOI once.

    This gives the team's xGF during that line's shift, with no overcounting.
    D pairs are handled identically (2-player average × pair TOI).

    The raw per-game estimate is then fed into predict_games.py as a *ratio*
    relative to the league-average lineup (league_lineup_xgf from league_avgs),
    so the absolute scale of ev_xgf_per60 doesn't need to match the Pythagorean
    xgf_5v5_rating scale used by the prediction formula.

    Args:
        lineup:        DailyFaceoff lineup  {line_id: [{id, name, pos, ...}]}
        player_impact: {str(playerId): impact_dict}
        league_avgs:   League average baselines from league_avg_impact.json
        name_lookup:   Name lookup dict from player_name_lookup.json

    Returns:
        {
          'xgf_per_game':  float,   # team's estimated 5v5 xGF per game (raw, per-line avg)
          'xga_per_game':  float,   # team's estimated 5v5 xGA per game (raw, per-line avg)
          'players_found': int,     # how many players were matched
          'total_players': int,     # total players in lineup
          'reliable':      bool,    # True if enough players matched
        }
    """
    if not lineup or not player_impact:
        return {'xgf_per_game': None, 'xga_per_game': None,
                'players_found': 0, 'total_players': 0, 'reliable': False}

    total_xgf = 0.0
    total_xga = 0.0
    found     = 0
    total     = 0

    for line_id, players in lineup.items():
        if line_id not in _LINE_TOI:
            continue

        line_toi_min  = _LINE_TOI[line_id]
        toi_hours     = line_toi_min / 60.0
        is_fwd_line   = line_id.startswith('f')

        # Collect rates for all players in this line/pair
        line_xgf_rates = []
        line_xga_rates = []

        for player in players:
            if not isinstance(player, dict):
                continue
            total += 1

            pid   = player.get('id') or player.get('playerId')
            pname = player.get('name', '')

            data = lookup_player(pid, pname, player_impact, name_lookup)

            if data and data.get('ev_toi_per_game', 0) >= MIN_EV_TOI_PER_GAME:
                line_xgf_rates.append(data['ev_xgf_per60'])
                line_xga_rates.append(data['ev_xga_per60'])
                found += 1
            else:
                # Replacement level: use league average for position group
                if is_fwd_line:
                    line_xgf_rates.append(league_avgs.get('fwd_ev_xgf_per60', 2.4))
                    line_xga_rates.append(league_avgs.get('fwd_ev_xga_per60', 2.4))
                else:
                    line_xgf_rates.append(league_avgs.get('def_ev_xgf_per60', 2.4))
                    line_xga_rates.append(league_avgs.get('def_ev_xga_per60', 2.4))

        # Average across the line (all players are on ice simultaneously),
        # then multiply by line TOI once — no per-player overcounting.
        if line_xgf_rates:
            total_xgf += (sum(line_xgf_rates) / len(line_xgf_rates)) * toi_hours
            total_xga += (sum(line_xga_rates) / len(line_xga_rates)) * toi_hours

    reliable = found >= MIN_LINEUP_MATCHES and total > 0

    return {
        'xgf_per_game':  round(total_xgf, 4) if total > 0 else None,
        'xga_per_game':  round(total_xga, 4) if total > 0 else None,
        'players_found': found,
        'total_players': total,
        'reliable':      reliable,
    }


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    calculate_player_impact()
