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
MIN_EV_TOI_SECONDS = 300     # 5 minutes total — low enough to catch recent callups

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
    "äéèêëáàâíïóöôúüûýšžčňř",
    "aeeeeaaaiiooouuuyszcnr"
)

# Known MoneyPuck name encoding issues — applied to raw CSV names before storage.
# Key: name as MoneyPuck delivers it (often drops diacritics incorrectly)
# Value: corrected display name (should match how DailyFaceoff lists the player)
_NAME_CORRECTIONS: dict[str, str] = {
    # MoneyPuck encoding issues: diacritics are dropped entirely (ü→"", ä→"", ö→"", ý→"", etc.)
    # rather than transliterated (ü→u, ä→a, …). Keys = raw MoneyPuck name; values = ASCII form
    # that our normName() will map to the same token as DailyFaceoff's version.
    'Oskar Bck':               'Oskar Back',               # ä dropped → "Bck"
    'Oskar Bäck':              'Oskar Back',               # if source ever restores the umlaut
    'Tim Sttzle':              'Tim Stutzle',              # ü dropped → "Sttzle"
    'Aatu Rty':                'Aatu Raty',                # ä dropped → "Rty"
    'Isac Lundestrm':          'Isac Lundestrom',          # ö dropped → "Lundestrm"
    'Juraj Slafkovsk':         'Juraj Slafkovsky',         # ý dropped → "Slafkovsk"
    'Martin Fehrvry':          'Martin Fehervary',         # é,á,í dropped → "Fehrvry"
    'Olli Mtt':                'Olli Maatta',              # ä dropped → "Mtt"
    'Matj  Blmel':             'Matej Blumel',             # ě,ü dropped → "Matj  Blmel"
    'Michael Brandsegg-Nygrd': 'Michael Brandsegg-Nygaard', # å dropped → "Nygrd"
}


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

        name  = _NAME_CORRECTIONS.get(str(row.get('name', '')), str(row.get('name', '')))
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

        # ── All-situations: game score, penalty diff, shot totals ──
        game_score         = 0.0
        penalty_diff_per60 = 0.0
        total_sog          = 0
        total_shot_attempts = 0
        if pid in idx_all:
            r_all    = idx_all[pid]
            all_toi  = _safe_float(r_all.get('icetime'), ev_toi)
            game_score = _safe_float(r_all.get('gameScore'))
            drawn  = _safe_float(r_all.get('penaltiesDrawn'))
            taken  = _safe_float(r_all.get('penalties'))
            penalty_diff_per60 = per60(drawn - taken, all_toi) if all_toi > 0 else 0.0
            total_sog           = int(_safe_float(r_all.get('I_F_shotsOnGoal', 0)))
            total_shot_attempts = int(_safe_float(r_all.get('I_F_shotAttempts', 0)))

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
            'penalty_diff_per60':  round(penalty_diff_per60, 4),
            'game_score':          round(game_score, 3),

            # Season shot totals (all situations, from MoneyPuck)
            'total_sog':           total_sog,
            'total_shot_attempts': total_shot_attempts,
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

    # Special-teams league averages — only among players with actual ST deployment.
    # pp_xgf_per60 == 0 means no PP time or sample too small (< MIN_ST_TOI_SECONDS).
    # These are the rates that real PP/PK units produce, not dragged down by
    # non-PP/PK players sitting at 0.
    pp_fwd = [v for v in fwd_profiles if v['pp_xgf_per60'] > 0]
    pp_def = [v for v in def_profiles if v['pp_xgf_per60'] > 0]
    pk_fwd = [v for v in fwd_profiles if v['pk_xga_per60'] > 0]
    pk_def = [v for v in def_profiles if v['pk_xga_per60'] > 0]

    league_avgs['fwd_pp_xgf_per60'] = _avg(pp_fwd, 'pp_xgf_per60')
    league_avgs['def_pp_xgf_per60'] = _avg(pp_def, 'pp_xgf_per60')
    league_avgs['fwd_pk_xga_per60'] = _avg(pk_fwd, 'pk_xga_per60')
    league_avgs['def_pk_xga_per60'] = _avg(pk_def, 'pk_xga_per60')

    # ── xG Above Average per game (xGAA/game) ──────────────────────────────────
    # Custom metric: expected goals added above a league-average player at the
    # same position group, per game, across four components:
    #   EV off  — xGF above league avg × EV TOI/game
    #   EV def  — xGA suppression vs league avg × EV TOI/game
    #   PP      — PP xGF above avg PP unit × PP TOI/game  (0 if no PP time)
    #   PK      — PK xGA suppression vs avg PK unit × PK TOI/game  (0 if no PK time)
    # Players who don't kill penalties receive 0 for the PK component — they are
    # neither rewarded nor penalized for not being on the ice during penalties.
    for _pid, data in player_impact.items():
        is_fwd  = data['is_forward']
        pos_key = 'fwd' if is_fwd else 'def'

        lg_ev_xgf = league_avgs[f'{pos_key}_ev_xgf_per60']
        lg_ev_xga = league_avgs[f'{pos_key}_ev_xga_per60']
        ev_toi_pg = data['ev_toi_per_game']   # seconds/game

        ev_off = (data['ev_xgf_per60'] - lg_ev_xgf) *  ev_toi_pg / 3600
        ev_def = -(data['ev_xga_per60'] - lg_ev_xga) * ev_toi_pg / 3600

        if data['pp_xgf_per60'] > 0:
            pp_val = (data['pp_xgf_per60'] - league_avgs[f'{pos_key}_pp_xgf_per60']) * data['pp_toi_per_game'] / 3600
        else:
            pp_val = 0.0

        if data['pk_xga_per60'] > 0:
            pk_val = -(data['pk_xga_per60'] - league_avgs[f'{pos_key}_pk_xga_per60']) * data['pk_toi_per_game'] / 3600
        else:
            pk_val = 0.0

        xgaa = ev_off + ev_def + pp_val + pk_val
        data['xgaa_per_game'] = round(xgaa, 4)
        data['xgaa_ev_off']   = round(ev_off, 4)
        data['xgaa_ev_def']   = round(ev_def, 4)
        data['xgaa_pp']       = round(pp_val, 4)
        data['xgaa_pk']       = round(pk_val, 4)

    print(f"  ✓ xGAA/game computed  "
          f"(lg PP fwd={league_avgs['fwd_pp_xgf_per60']:.3f}  "
          f"PK fwd={league_avgs['fwd_pk_xga_per60']:.3f})")

    # ── League-average lineup baseline (for ratio-based blending) ──────────────
    # What estimate_lineup_xg returns for a perfectly average 18-player team.
    # Computed as the TOI-weighted average rate for a simulated avg roster:
    #   12 forwards each at (fwd_avg_toi, fwd_avg_xgf/xga_per60)
    #    6 D        each at (def_avg_toi, def_avg_xgf/xga_per60)
    # This baseline is used in predict_games.py to produce a dimensionless
    # quality ratio: lineup_rate / league_xgf_rate.
    fwd_avg_toi = _avg(fwd_profiles, 'ev_toi_per_game')   # seconds/game
    def_avg_toi = _avg(def_profiles, 'ev_toi_per_game')
    n_fwd, n_def = 12, 6

    _num_xgf = (n_fwd * fwd_avg_toi * league_avgs['fwd_ev_xgf_per60'] +
                n_def * def_avg_toi * league_avgs['def_ev_xgf_per60'])
    _num_xga = (n_fwd * fwd_avg_toi * league_avgs['fwd_ev_xga_per60'] +
                n_def * def_avg_toi * league_avgs['def_ev_xga_per60'])
    _den     =  n_fwd * fwd_avg_toi + n_def * def_avg_toi

    league_xgf_rate = _num_xgf / _den
    league_xga_rate = _num_xga / _den

    league_avgs['league_xgf_rate']      = round(league_xgf_rate, 4)
    league_avgs['league_xga_rate']      = round(league_xga_rate, 4)
    league_avgs['fwd_ev_toi_per_game']  = round(fwd_avg_toi, 1)
    league_avgs['def_ev_toi_per_game']  = round(def_avg_toi, 1)

    print(f"  League avg lineup  xGF/60={league_xgf_rate:.3f}  xGA/60={league_xga_rate:.3f}  (TOI-weighted, 18 players, used for ratio-blend)")
    print(f"  League avg fwd  xGF/60={league_avgs['fwd_ev_xgf_per60']:.3f}  xGA/60={league_avgs['fwd_ev_xga_per60']:.3f}  toi={fwd_avg_toi/60:.1f}min")
    print(f"  League avg def  xGF/60={league_avgs['def_ev_xgf_per60']:.3f}  xGA/60={league_avgs['def_ev_xga_per60']:.3f}  toi={def_avg_toi/60:.1f}min")

    # ── Per-team lineup baselines ─────────────────────────────────────────────
    # For each team, compute the TOI-weighted average xGF/xGA rate across ALL
    # qualifying players in the MoneyPuck dataset.
    #
    # This represents the team's "historical average lineup quality" — i.e., what
    # estimate_lineup_xg() returns when everyone plays at their seasonal average.
    # Used in the frontend to answer: "is tonight's lineup stronger or weaker
    # than this team usually fields?" (vs. Tm label).
    _team_accum: dict = {}
    for data in player_impact.values():
        team = data['team']
        toi  = data['ev_toi_per_game']
        if team not in _team_accum:
            _team_accum[team] = {'xgf_sum': 0.0, 'xga_sum': 0.0, 'toi_sum': 0.0}
        _team_accum[team]['xgf_sum'] += data['ev_xgf_per60'] * toi
        _team_accum[team]['xga_sum'] += data['ev_xga_per60'] * toi
        _team_accum[team]['toi_sum'] += toi

    team_lineup_baselines: dict = {}
    for team, sums in _team_accum.items():
        if sums['toi_sum'] > 0:
            team_lineup_baselines[team] = {
                'xgf_rate': round(sums['xgf_sum'] / sums['toi_sum'], 4),
                'xga_rate': round(sums['xga_sum'] / sums['toi_sum'], 4),
            }

    print(f"  Per-team baselines built for {len(team_lineup_baselines)} teams")

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

    # team_lineup_baselines.json
    baselines_file = 'team_lineup_baselines.json'
    local_baselines = os.path.join(script_dir, baselines_file)
    _save(team_lineup_baselines, local_baselines)
    print(f"  ✓ {baselines_file} ({len(team_lineup_baselines)} teams)")

    # Sync to public/data for optional frontend consumption
    try:
        if os.path.exists(public_data):
            import shutil
            shutil.copy(local_impact,    os.path.join(public_data, output_file))
            shutil.copy(local_avg,       os.path.join(public_data, league_avg_file))
            shutil.copy(local_baselines, os.path.join(public_data, baselines_file))
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


def load_team_baselines(script_dir: str = None) -> dict:
    """
    Load pre-computed per-team lineup baselines from team_lineup_baselines.json.

    Returns:
        {tri_code: {'xgf_rate': float, 'xga_rate': float}}
        Empty dict on failure — caller should degrade gracefully (no vs-team label).
    """
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))

    path = os.path.join(script_dir, 'team_lineup_baselines.json')
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print("  [WARN] team_lineup_baselines.json not found — vs-team label disabled.")
        return {}
    except Exception as e:
        print(f"  [WARN] Could not load team_lineup_baselines.json: {e}")
        return {}


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

# Minimum players matched in lineup to trust lineup estimate
MIN_LINEUP_MATCHES = 5

# Valid DFO line identifiers
_VALID_LINE_IDS = {'f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3'}


def estimate_lineup_xg(
    lineup: dict,
    player_impact: dict,
    league_avgs: dict,
    name_lookup: dict,
) -> dict:
    """
    Estimate a team's 5v5 xGF and xGA quality from the projected lineup.

    DESIGN — TOI-weighted average across all 18 skaters:
    Each player's ev_xgf_per60 and ev_xga_per60 are weighted by their actual
    ev_toi_per_game (from MoneyPuck), not by hardcoded line estimates.

    Why this is better than the old per-line approach:
      • Eichel (15.3 min) correctly outweighs a 4th-liner (8 min).
      • Theodore (19.3 min, top defensive pair) gets appropriate weight.
      • Offensive D like Makar (ev_xgf/60=3.06) contribute to xGF quality
        just as naturally as top forwards — no artificial forward/D split.
      • When a star is absent, their slot uses replacement-level rates
        (85% of league avg xGF, 115% of league avg xGA) to model a call-up,
        not a league-average NHLer.

    The returned rates are compared to league_xgf_rate / league_xga_rate
    (pre-computed TOI-weighted averages for a perfectly average 18-player
    team) to produce a dimensionless quality ratio in predict_games.py.

    Args:
        lineup:        DailyFaceoff lineup  {line_id: [{id, name, pos, ...}]}
        player_impact: {str(playerId): impact_dict}
        league_avgs:   League average baselines from league_avg_impact.json
        name_lookup:   Name lookup dict from player_name_lookup.json

    Returns:
        {
          'xgf_rate':      float,  # TOI-weighted avg ev_xgf_per60 for this lineup
          'xga_rate':      float,  # TOI-weighted avg ev_xga_per60 for this lineup
          'players_found': int,    # how many players were matched in player_impact
          'total_players': int,    # total players in lineup
          'reliable':      bool,   # True if enough players matched
        }
    """
    if not lineup or not player_impact:
        return {'xgf_rate': None, 'xga_rate': None,
                'players_found': 0, 'total_players': 0, 'reliable': False}

    # Replacement-level rates: model a call-up, not a league-average player.
    # Forwards: 85% of avg offense, 115% of avg goals-against (worse both ways)
    # D:        same logic applied to defensive-position averages
    fwd_repl_xgf = league_avgs.get('fwd_ev_xgf_per60', 2.37) * 0.85
    fwd_repl_xga = league_avgs.get('fwd_ev_xga_per60', 2.45) * 1.15
    def_repl_xgf = league_avgs.get('def_ev_xgf_per60', 2.40) * 0.85
    def_repl_xga = league_avgs.get('def_ev_xga_per60', 2.50) * 1.15
    fwd_repl_toi = league_avgs.get('fwd_ev_toi_per_game', 708.0) * 0.85
    def_repl_toi = league_avgs.get('def_ev_toi_per_game', 936.0) * 0.85

    xgf_sum = 0.0
    xga_sum = 0.0
    toi_sum = 0.0
    found   = 0
    total   = 0

    for line_id, players in lineup.items():
        if line_id not in _VALID_LINE_IDS:
            continue
        is_fwd = line_id.startswith('f')

        for player in players:
            if not isinstance(player, dict):
                continue
            total += 1

            pid   = player.get('id') or player.get('playerId')
            pname = player.get('name', '')

            data = lookup_player(pid, pname, player_impact, name_lookup)

            if data and data.get('ev_toi_per_game', 0) >= MIN_EV_TOI_PER_GAME:
                toi = data['ev_toi_per_game']          # seconds/game
                xgf_sum += data['ev_xgf_per60'] * toi
                xga_sum += data['ev_xga_per60'] * toi
                toi_sum += toi
                found   += 1
            else:
                # Replacement-level slot — position-specific
                r_xgf = fwd_repl_xgf if is_fwd else def_repl_xgf
                r_xga = fwd_repl_xga if is_fwd else def_repl_xga
                r_toi = fwd_repl_toi if is_fwd else def_repl_toi
                xgf_sum += r_xgf * r_toi
                xga_sum += r_xga * r_toi
                toi_sum += r_toi

    if toi_sum == 0 or total == 0:
        return {'xgf_rate': None, 'xga_rate': None,
                'players_found': 0, 'total_players': 0, 'reliable': False}

    reliable = found >= MIN_LINEUP_MATCHES

    return {
        'xgf_rate':      round(xgf_sum / toi_sum, 4),
        'xga_rate':      round(xga_sum / toi_sum, 4),
        'players_found': found,
        'total_players': total,
        'reliable':      reliable,
    }


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    calculate_player_impact()
