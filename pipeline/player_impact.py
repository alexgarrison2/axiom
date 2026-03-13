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

  PBP-derived (5v5, from pbp_metrics.json computed by calc_pbp_impact.py):
    pbp_ihd_per60       Individual HD shot attempts per 60 (7-bin definition)
                        Used in Fwd EV OFF impact score blend.
    pbp_oihda_per60     On-ice HD attempts Against per 60
                        Used in Def EV DEF impact score blend.
    pbp_oihdf_per60     On-ice HD attempts For per 60
                        Used in Def EV DEF impact score blend.

  Special teams:
    pp_xgf_per60        On-ice xGoals For per 60 on the PP (5on4)
    pk_xga_per60        On-ice xGoals Against per 60 on the PK (4on5)

  Context:
    penalty_diff_per60  (Drawn − Taken) per 60 (positive = penalty-drawer)
    game_score          MoneyPuck's all-in-one rating

Impact score:
  Forwards  (EV Off 50%, EV Def 20%, PP 20%, PK 10%):
    EV OFF = 4-way blend: ind_xg_per60, ev_prod_per60, xgaa_ev_off,
             pbp_ihd_per60 (if pbp_metrics.json available)
  Defenders (EV Off 25%, EV Def 40%, PP 15%, PK 20%):
    EV DEF = 2-way blend: xgaa_ev_def, -pbp_oihda_per60
             (if pbp_metrics.json available)

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

# Min PP/PK TOI per game to earn a special-teams xGAA component.
# Players below this are accidentally on ice during ST, not genuine ST players.
# 35s/game ≈ bottom of real deployment; filters out 0:05/gm "accidental" PKers.
MIN_ST_TOI_PER_GAME = 35     # seconds per game

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

def _load_pbp_metrics(script_dir: str) -> dict:
    """
    Load raw PBP counts from pbp_metrics.json (produced by calc_pbp_impact.py).

    Returns: {player_key: {ihd_attempts, oihda, oihdf, oixgf, oixga, oif, oia}}
             Empty dict if file not found.
    """
    path = os.path.join(script_dir, "pbp_metrics.json")
    try:
        with open(path) as f:
            data = json.load(f)
        print(f"  Loaded pbp_metrics.json ({len(data)} player keys)")
        return data
    except FileNotFoundError:
        print("  [INFO] pbp_metrics.json not found — run calc_pbp_impact.py first.")
        print("         PBP HD metrics will not be included in impact scores.")
        return {}
    except Exception as e:
        print(f"  [WARN] Could not load pbp_metrics.json: {e}")
        return {}


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

    # ── Load PBP metrics (calc_pbp_impact.py must have run first) ──
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pbp_metrics = _load_pbp_metrics(script_dir)

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

        # ── Individual 5v5 production (scoring + playmaking) ──
        # Weighted points at 5v5: goals + primary assists + 0.5 × secondary assists.
        # Crucial for ranking playmakers like Crosby who generate fewer shots but
        # contribute heavily through primary assists.  Per-60 to normalise for TOI.
        ev_goals     = _safe_float(row.get('I_F_goals'))
        ev_pri_a     = _safe_float(row.get('I_F_primaryAssists'))
        ev_sec_a     = _safe_float(row.get('I_F_secondaryAssists'))
        ev_prod_per60 = per60(ev_goals + ev_pri_a + 0.5 * ev_sec_a, ev_toi)

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

        # ── All-situations: game score, penalty diff, shot totals, season stats ──
        game_score         = 0.0
        penalty_diff_per60 = 0.0
        total_sog          = 0
        total_shot_attempts = 0
        goals              = 0
        assists            = 0
        points             = 0
        toi_per_game_all   = 0.0
        if pid in idx_all:
            r_all    = idx_all[pid]
            all_toi  = _safe_float(r_all.get('icetime'), ev_toi)
            game_score = _safe_float(r_all.get('gameScore'))
            drawn  = _safe_float(r_all.get('penaltiesDrawn'))
            taken  = _safe_float(r_all.get('penalties'))
            penalty_diff_per60 = per60(drawn - taken, all_toi) if all_toi > 0 else 0.0
            total_sog           = int(_safe_float(r_all.get('I_F_shotsOnGoal', 0)))
            total_shot_attempts = int(_safe_float(r_all.get('I_F_shotAttempts', 0)))
            goals    = int(_safe_float(r_all.get('I_F_goals', 0)))
            assists  = int(_safe_float(r_all.get('I_F_primaryAssists', 0))) + \
                       int(_safe_float(r_all.get('I_F_secondaryAssists', 0)))
            points   = goals + assists
            toi_per_game_all = round(all_toi / gp / 60.0, 2) if gp > 0 else 0.0

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
            'ev_prod_per60':   round(ev_prod_per60, 4),   # weighted pts/60 at 5v5

            # Special teams
            'pp_xgf_per60': round(pp_xgf_per60, 4),
            'pk_xga_per60': round(pk_xga_per60, 4),

            # Context
            'penalty_diff_per60':  round(penalty_diff_per60, 4),
            'game_score':          round(game_score, 3),

            # Season shot totals (all situations, from MoneyPuck)
            'total_sog':           total_sog,
            'total_shot_attempts': total_shot_attempts,
            # Season counting stats (all situations)
            'goals':               goals,
            'assists':             assists,
            'points':              points,
            'sog_per_game':        round(total_sog / gp, 2) if gp > 0 else 0.0,
            'toi_per_game_all':    toi_per_game_all,
        }

    print(f"  Built profiles for {len(player_impact)} players (after min-TOI filter)")

    # ── Merge PBP metrics into player profiles ─────────────────────────────
    # Rates are computed here using MoneyPuck 5v5 TOI as denominator.
    # This is more accurate than using shift-summed all-situations TOI.
    # We also build a name → pid index so HTML-sourced name keys can be resolved.
    if pbp_metrics:
        # Build name→pid lookup from current profiles for HTML-sourced fallback
        _pbp_name_idx = {
            d['name'].lower().strip(): pid
            for pid, d in player_impact.items()
            if d.get('name')
        }

        pbp_merged = 0
        for raw_key, counts in pbp_metrics.items():
            # Resolve player: numeric key matches MoneyPuck player_id directly
            pid = None
            if raw_key in player_impact:
                pid = raw_key
            else:
                # Fall back to name-based lookup (HTML-sourced shifts produce names)
                pid = _pbp_name_idx.get(raw_key.lower().strip())
                if pid is None:
                    # Partial name match
                    for norm_name, ppid in _pbp_name_idx.items():
                        if raw_key.lower() in norm_name or norm_name in raw_key.lower():
                            pid = ppid
                            break

            if pid is None or pid not in player_impact:
                continue

            data = player_impact[pid]
            # Use MoneyPuck 5v5 TOI (seconds) as denominator for per-60 rates
            ev_toi_total = data['ev_toi_per_game'] * max(data['games_played'], 1)
            if ev_toi_total < 1:
                continue

            def _per60_pbp(n, toi=ev_toi_total):
                return round((n / toi) * 3600.0, 4) if toi >= 60 else 0.0

            ihd   = counts.get('ihd_attempts', 0)
            oihda = counts.get('oihda', 0)
            oihdf = counts.get('oihdf', 0)
            oixgf = counts.get('oixgf', 0.0)
            oixga = counts.get('oixga', 0.0)
            oif   = counts.get('oif', 0)
            oia   = counts.get('oia', 0)

            data['pbp_ihd_per60']   = _per60_pbp(ihd)
            data['pbp_oihda_per60'] = _per60_pbp(oihda)
            data['pbp_oihdf_per60'] = _per60_pbp(oihdf)
            data['pbp_oixgf_per60'] = _per60_pbp(oixgf)
            data['pbp_oixga_per60'] = _per60_pbp(oixga)
            hd_total = oihdf + oihda
            data['pbp_oihdcf_pct']  = round(oihdf / hd_total, 4) if hd_total > 0 else 0.0
            cf_total = oif + oia
            data['pbp_oicf_pct']    = round(oif / cf_total, 4) if cf_total > 0 else 0.0
            pbp_merged += 1

        print(f"  PBP metrics merged into {pbp_merged} player profiles (per-60 using MoneyPuck 5v5 TOI)")
    else:
        print("  PBP metrics unavailable — impact scores will use MoneyPuck signals only")

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
    pp_fwd = [v for v in fwd_profiles if v['pp_xgf_per60'] > 0 and v['pp_toi_per_game'] >= MIN_ST_TOI_PER_GAME]
    pp_def = [v for v in def_profiles if v['pp_xgf_per60'] > 0 and v['pp_toi_per_game'] >= MIN_ST_TOI_PER_GAME]
    pk_fwd = [v for v in fwd_profiles if v['pk_xga_per60'] > 0 and v['pk_toi_per_game'] >= MIN_ST_TOI_PER_GAME]
    pk_def = [v for v in def_profiles if v['pk_xga_per60'] > 0 and v['pk_toi_per_game'] >= MIN_ST_TOI_PER_GAME]

    league_avgs['fwd_pp_xgf_per60'] = _avg(pp_fwd, 'pp_xgf_per60')
    league_avgs['def_pp_xgf_per60'] = _avg(pp_def, 'pp_xgf_per60')
    league_avgs['fwd_pk_xga_per60'] = _avg(pk_fwd, 'pk_xga_per60')
    league_avgs['def_pk_xga_per60'] = _avg(pk_def, 'pk_xga_per60')

    # PBP HD averages — only among players with PBP data (pbp_ihd_per60 > 0)
    fwd_with_pbp = [v for v in fwd_profiles if v.get('pbp_ihd_per60') is not None]
    def_with_pbp = [v for v in def_profiles if v.get('pbp_oihda_per60') is not None]
    if fwd_with_pbp:
        league_avgs['fwd_pbp_ihd_per60']   = _avg(fwd_with_pbp, 'pbp_ihd_per60')
        league_avgs['fwd_pbp_oihda_per60'] = _avg(fwd_with_pbp, 'pbp_oihda_per60')
    if def_with_pbp:
        league_avgs['def_pbp_oihda_per60'] = _avg(def_with_pbp, 'pbp_oihda_per60')
        league_avgs['def_pbp_oihdf_per60'] = _avg(def_with_pbp, 'pbp_oihdf_per60')
        league_avgs['def_pbp_ihd_per60']   = _avg(def_with_pbp, 'pbp_ihd_per60')
    if fwd_with_pbp or def_with_pbp:
        print(f"  PBP coverage — fwd: {len(fwd_with_pbp)}/{len(fwd_profiles)}  "
              f"def: {len(def_with_pbp)}/{len(def_profiles)}")

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

        if data['pp_xgf_per60'] > 0 and data['pp_toi_per_game'] >= MIN_ST_TOI_PER_GAME:
            pp_val = (data['pp_xgf_per60'] - league_avgs[f'{pos_key}_pp_xgf_per60']) * data['pp_toi_per_game'] / 3600
        else:
            pp_val = 0.0

        if data['pk_xga_per60'] > 0 and data['pk_toi_per_game'] >= MIN_ST_TOI_PER_GAME:
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

    # ── Position-weighted composite IMPACT score ──────────────────────────────
    # Uses z-score normalization within position groups so each pillar has equal
    # variance contribution before weighting.  Weights reflect the fact that:
    #   • Forwards derive most value from EV offense (isolation metric)
    #   • Defensemen derive most value from EV defense
    #   • PP / PK are real but secondary contributions for both positions
    #
    # EV OFF signal: relative_xgf_pct (Bayesian-shrunken on/off split) —
    #   isolates individual impact from linemate quality.  MacKinnon's elite
    #   relative xGF% will dominate here regardless of who he plays with.
    # EV DEF signal: -ev_xga_per60 (on-ice xGA rate, sign-flipped so higher=better)
    # PP / PK signals: xgaa_pp / xgaa_pk (already 0 for inactive ST players)
    #
    # Forward weights:   EV Off 50%, EV Def 20%, PP 20%, PK 10%
    # Defenseman weights: EV Off 25%, EV Def 40%, PP 15%, PK 20%

    def _compute_position_impact(pid_list: list, fwd_weights: bool) -> None:
        """Z-score each pillar within this group, apply weights, store results."""
        if not pid_list:
            return
        data_list = [player_impact[p] for p in pid_list]

        def zsc(arr: np.ndarray) -> np.ndarray:
            mu, sigma = float(np.mean(arr)), float(np.std(arr))
            return (arr - mu) / sigma if sigma > 1e-9 else np.zeros(len(arr))

        # ── Bayesian shrinkage for small-sample players ───────────────────────
        ev_toi_total = np.array([
            d['ev_toi_per_game'] * max(d['games_played'], 1) for d in data_list
        ])
        shrink = ev_toi_total / (ev_toi_total + RELATIVE_SHRINKAGE_ANCHOR)

        # ── EV OFF: signal blend ──────────────────────────────────────────────
        # Base signals (always present, from MoneyPuck):
        #  1. ind_xg_per60   — individual 5v5 xG/60 (shooting/scoring threat)
        #  2. ev_prod_per60  — weighted 5v5 pts/60 (goals + A1 + 0.5×A2)
        #  3. xgaa_ev_off    — team on-ice xGF above avg × TOI
        #
        # PBP signal (Forwards only, when pbp_metrics.json is available):
        #  4. pbp_ihd_per60  — individual HD shot attempts/60 (7-bin definition,
        #                      on a 5v5 TOI basis). Captures the volume of
        #                      dangerous shot attempts from the slot/crease area,
        #                      complementing ind_xg_per60 (expected quality of shots).
        #
        # If PBP signal is available:  4-way equal blend → forward EV OFF
        # If PBP signal is missing:    3-way equal blend (original behavior)
        ind_xg_raw   = np.array([d['ind_xg_per60']  for d in data_list])
        ev_prod_raw  = np.array([d['ev_prod_per60']  for d in data_list])
        xgaa_off_raw = np.array([d['xgaa_ev_off']    for d in data_list])

        mean_ind_xg  = float(np.mean(ind_xg_raw))
        mean_ev_prod = float(np.mean(ev_prod_raw))

        ind_xg_s   = mean_ind_xg  + (ind_xg_raw  - mean_ind_xg)  * shrink
        ev_prod_s  = mean_ev_prod + (ev_prod_raw  - mean_ev_prod) * shrink
        xgaa_off_s = xgaa_off_raw * shrink

        z_ind_off  = zsc(ind_xg_s)
        z_prod_off = zsc(ev_prod_s)
        z_team_off = zsc(xgaa_off_s)

        # PBP individual HD/60 signal — Forwards only
        # Fills missing values (no PBP data) with position-group mean so those
        # players get z ≈ 0 for this component rather than being penalized.
        pbp_ihd_raw = np.array([
            d.get('pbp_ihd_per60', np.nan) for d in data_list
        ])
        has_pbp_fwd = np.isfinite(pbp_ihd_raw).any()
        if fwd_weights and has_pbp_fwd:
            mean_pbp_ihd = float(np.nanmean(pbp_ihd_raw))
            pbp_ihd_fill = np.where(np.isfinite(pbp_ihd_raw), pbp_ihd_raw, mean_pbp_ihd)
            pbp_ihd_s    = mean_pbp_ihd + (pbp_ihd_fill - mean_pbp_ihd) * shrink
            z_pbp_ihd    = zsc(pbp_ihd_s)
            # 4-way equal blend: ind_xg, ev_prod, team_off, pbp_ihd
            ev_off_arr = (z_ind_off + z_prod_off + z_team_off + z_pbp_ihd) / 4.0
        else:
            z_pbp_ihd  = np.zeros(len(data_list))
            # 3-way equal blend (original)
            ev_off_arr = (z_ind_off + z_prod_off + z_team_off) / 3.0

        # ── EV DEF: signal blend ──────────────────────────────────────────────
        # Base signal (always present, from MoneyPuck):
        #  1. xgaa_ev_def      — xG saved above avg × TOI (higher = better defense)
        #
        # PBP signal (Defenders only, when pbp_metrics.json is available):
        #  2. -pbp_oihda_per60 — on-ice HD attempts Against/60 (sign-flipped:
        #                        fewer HD against = better). Captures shot suppression.
        #
        # oihdf (on-ice HD For) is intentionally excluded — it reflects team
        # offensive quality, not individual defensive ability, and introduces
        # heavy team-context bias (defenders on elite offenses score too high).
        #
        # If PBP signal available:  2-way equal blend → defender EV DEF
        # If PBP signal missing:    1-way (original xgaa_ev_def only)
        xgaa_def_raw = np.array([d['xgaa_ev_def'] for d in data_list])

        pbp_oihda_raw = np.array([d.get('pbp_oihda_per60', np.nan) for d in data_list])
        has_pbp_def = np.isfinite(pbp_oihda_raw).any()
        if not fwd_weights and has_pbp_def:
            mean_pbp_oihda  = float(np.nanmean(pbp_oihda_raw))
            pbp_oihda_fill  = np.where(np.isfinite(pbp_oihda_raw), pbp_oihda_raw, mean_pbp_oihda)
            pbp_oihda_s     = mean_pbp_oihda + (pbp_oihda_fill - mean_pbp_oihda) * shrink
            z_xgaa_def      = zsc(xgaa_def_raw * shrink)
            z_pbp_hda       = zsc(-pbp_oihda_s)   # negate: lower HD against = better
            # 2-way equal blend: xgaa_ev_def, -pbp_oihda
            ev_def_arr = (z_xgaa_def + z_pbp_hda) / 2.0
        else:
            ev_def_arr = xgaa_def_raw * shrink

        pp_arr = np.array([d['xgaa_pp'] for d in data_list])
        pk_arr = np.array([d['xgaa_pk'] for d in data_list])

        z_off = zsc(ev_off_arr)
        z_def = zsc(ev_def_arr)
        z_pp  = zsc(pp_arr)
        z_pk  = zsc(pk_arr)

        if fwd_weights:
            w_off, w_def, w_pp, w_pk = 0.50, 0.20, 0.20, 0.10
        else:
            w_off, w_def, w_pp, w_pk = 0.25, 0.40, 0.15, 0.20

        composite = w_off * z_off + w_def * z_def + w_pp * z_pp + w_pk * z_pk

        for i, pid in enumerate(pid_list):
            player_impact[pid]['impact_ev_off'] = round(float(z_off[i]), 3)
            player_impact[pid]['impact_ev_def'] = round(float(z_def[i]), 3)
            player_impact[pid]['impact_pp']     = round(float(z_pp[i]),  3)
            player_impact[pid]['impact_pk']     = round(float(z_pk[i]),  3)
            player_impact[pid]['impact_score']  = round(float(composite[i]), 3)

    fwd_pids = [pid for pid, d in player_impact.items() if d['is_forward']]
    def_pids = [pid for pid, d in player_impact.items() if not d['is_forward']]
    _compute_position_impact(fwd_pids, fwd_weights=True)
    _compute_position_impact(def_pids, fwd_weights=False)
    print(f"  ✓ impact_score computed ({len(fwd_pids)} fwd, {len(def_pids)} def)")

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
