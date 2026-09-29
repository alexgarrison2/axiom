from season import season_file, PREV_START_YEAR, season_of_game_id
import pandas as pd
import json
import os
import argparse
import numpy as np

# Determine paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR) # Parent of pipeline
PUBLIC_DATA_DIR = os.path.join(PROJECT_ROOT, 'public', 'data')

# Regression Parameters
REGRESSION_GAMES = 10
# Share of last season's above/below-average xG a team carries into the new
# season (the rest regresses to league mean for roster turnover).
PRIOR_KEEP = 0.5
XG_COLS = ['xG_for', 'xG_against', 'xG_for_5v5', 'xG_against_5v5']


def load_prior_season_games():
    """Last season's regular-season rows (archived by archive_season.py)."""
    path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
    if not os.path.exists(path):
        return None
    hist = pd.read_csv(path, low_memory=False)
    is_prev = hist['game_id'].map(season_of_game_id) == PREV_START_YEAR
    is_regular = hist['game_id'].astype(str).str[4:6] == '02'
    prior = hist[is_prev & is_regular]
    return prior if not prior.empty else None


def team_priors(prior_df):
    """League per-game xG averages and each team's regressed per-game xG last season."""
    league = prior_df[XG_COLS].mean()
    team_means = prior_df.groupby('team')[XG_COLS].mean()
    priors = {
        team: {c: league[c] + PRIOR_KEEP * (row[c] - league[c]) for c in XG_COLS}
        for team, row in team_means.iterrows()
    }
    return league, priors


def blended_rating(series, target):
    """50% recent form (EWMA, halflife 7 games) + 50% season average regressed
    toward `target` with REGRESSION_GAMES of weight. Recent form ramps in over
    the first REGRESSION_GAMES games so one early game can't swing a rating.
    Returns (rating, rolling)."""
    gp = len(series)
    regressed = (series.sum() + REGRESSION_GAMES * target) / (gp + REGRESSION_GAMES)
    if gp == 0:
        return regressed, target
    rolling = series.ewm(halflife=7, min_periods=1).mean().iloc[-1]
    w_recent = 0.5 * min(1.0, gp / REGRESSION_GAMES)
    return rolling * w_recent + regressed * (1 - w_recent), rolling


def calculate_ratings(df=None, gamestats_file=season_file("gamestats"), save_files=True):
    # Production runs (df loaded from disk) regress toward last season's
    # ratings; backtests pass df and regress toward the league mean.
    prior_df = None
    if df is None:
        prior_df = load_prior_season_games()
        if os.path.exists(gamestats_file):
            print(f"Loading data from {gamestats_file}...")
            df = pd.read_csv(gamestats_file)
        elif prior_df is not None:
            print(f"{gamestats_file} not found (no games yet) - ratings from last season")
            df = prior_df.iloc[0:0].copy()
        else:
            raise FileNotFoundError(gamestats_file)

    prior_league, priors = team_priors(prior_df) if prior_df is not None else (None, {})

    # --- Team Ratings ---
    # Teams with no games yet this season are rated from their prior alone.
    teams = sorted(set(df['team'].unique()) | set(priors))
    team_ratings = {}

    # League Averages for normalization. With a prior, blend in last season's
    # averages worth REGRESSION_GAMES games per team so the first nights of a
    # season don't set the baseline.
    prior_rows = 32 * REGRESSION_GAMES

    def league_avg(col):
        if prior_league is None:
            return df[col].mean()
        return (df[col].sum() + prior_rows * prior_league[col]) / (len(df) + prior_rows)

    league_xg_for = league_avg('xG_for')
    # Check if 5v5 data is valid (sum > 0)
    has_5v5_data = 'xG_for_5v5' in df.columns and (
        df['xG_for_5v5'].sum() > 0 or (df.empty and prior_league is not None))

    if has_5v5_data:
        league_xg_5v5 = league_avg('xG_for_5v5')
    else:
        league_xg_5v5 = league_xg_for * 0.8 # Fallback to 80%

    for team in teams:
        team_games = df[df['team'] == team].sort_values('game_date')
        games_played = len(team_games)
        prior = priors.get(team, {})

        # League Avg xG For is approx League Avg xG Against, so both sides
        # regress toward league_xg_for when there's no team prior.
        xgf_rating, rolling_xgf = blended_rating(team_games['xG_for'], prior.get('xG_for', league_xg_for))
        xga_rating, rolling_xga = blended_rating(team_games['xG_against'], prior.get('xG_against', league_xg_for))

        # SAFETY FLOOR: If data is missing (0.0), default to LEAGUE AVERAGE
        if xgf_rating < 0.5:
            print(f"DEBUG: Patching xGF for {team} (was {xgf_rating:.2f}) -> Setting to League Avg")
            xgf_rating = league_xg_for
        if xga_rating < 0.5:
            xga_rating = league_xg_for

        if has_5v5_data:
            xgf_5v5_rating, _ = blended_rating(team_games['xG_for_5v5'], prior.get('xG_for_5v5', league_xg_5v5))
            xga_5v5_rating, _ = blended_rating(team_games['xG_against_5v5'], prior.get('xG_against_5v5', league_xg_5v5))
        else:
            xgf_5v5_rating = xgf_rating * 0.8 # Fallback heuristic
            xga_5v5_rating = xga_rating * 0.8

        
        # Special Teams Ratings
        # PP% = PP Goals / PP Opps
        # PK% = 1 - (PP Goals Against / PK Opps)
        
        # Season Totals
        pp_goals = team_games['pp_goals'].sum()
        pp_opps = team_games['pp_opportunities'].sum()
        pp_pct = pp_goals / pp_opps if pp_opps > 0 else 0.20 # League Avg approx 20%
        # New: Penalties Taken/Drawn per game (Volume)
        # Regressed toward ~3/game with REGRESSION_GAMES of weight (stable early season)
        penalties_drawn_per_game = (pp_opps + REGRESSION_GAMES * 3.0) / (games_played + REGRESSION_GAMES)
        
        pk_goals_ag = team_games['pp_goals_against'].sum()
        pk_opps = team_games['pk_opportunities'].sum()
        pk_pct = 1 - (pk_goals_ag / pk_opps) if pk_opps > 0 else 0.80 # League Avg approx 80%
        penalties_taken_per_game = (pk_opps + REGRESSION_GAMES * 3.0) / (games_played + REGRESSION_GAMES)
        
        # Weighted Special Teams Ratings (User Request: 40% L10, 50% L20, 10% Season)
        
        # Helper to calc efficiency safely
        def calc_eff(goals, opps, default=0.0):
             return goals / opps if opps > 0 else default

        # 1. Season (10%)
        # already calculated: pp_goals, pp_opps, pk_goals_ag, pk_opps
        season_pp_pct = calc_eff(pp_goals, pp_opps, 0.20)
        season_pk_pct = 1 - calc_eff(pk_goals_ag, pk_opps, 0.20)
        
        # 2. Last 20 Games (50%)
        l20_games = team_games.tail(20)
        l20_pp_goals = l20_games['pp_goals'].sum()
        l20_pp_opps = l20_games['pp_opportunities'].sum()
        l20_pp_pct = calc_eff(l20_pp_goals, l20_pp_opps, season_pp_pct)
        
        l20_pk_ga = l20_games['pp_goals_against'].sum()
        l20_pk_opps = l20_games['pk_opportunities'].sum()
        l20_pk_pct = 1 - calc_eff(l20_pk_ga, l20_pk_opps, 1 - season_pk_pct)
        
        # 3. Last 10 Games (40%)
        l10_games = team_games.tail(10)
        l10_pp_goals = l10_games['pp_goals'].sum()
        l10_pp_opps = l10_games['pp_opportunities'].sum()
        l10_pp_pct = calc_eff(l10_pp_goals, l10_pp_opps, season_pp_pct)
        
        l10_pk_ga = l10_games['pp_goals_against'].sum()
        l10_pk_opps = l10_games['pk_opportunities'].sum()
        l10_pk_pct = 1 - calc_eff(l10_pk_ga, l10_pk_opps, 1 - season_pk_pct)
        
        # Weighted Average
        # pp_rating = (l10 * 0.4) + (l20 * 0.5) + (season * 0.1)
        # Note: If < 10 games, use season for all. If < 20 games, use season for L20.
        
        w_l10 = 0.4
        w_l20 = 0.5
        w_sea = 0.1
        
        # Use Season Totals for Public Display consistency
        # User expects these to match H-Ref / Official Stats
        pp_rating = season_pp_pct * 100
        pk_rating = season_pk_pct * 100
        
        # Store weighted for potentially internal use (optional)
        # pp_rating_weighted = (season_pp_pct * 0.1) + (l20_pp_pct * 0.5) + (l10_pp_pct * 0.4)
        # pk_rating_weighted = (season_pk_pct * 0.1) + (l20_pk_pct * 0.5) + (l10_pk_pct * 0.4)

        # xG-based PP/PK rates (per opportunity)
        # More stable than goal-based PP%/PK% — same xG philosophy used throughout the model.
        # Falls back to 0.18 (league-average baseline) if xG_pp columns not yet in gamestats.
        # Regressed toward that baseline with ~10 games of opportunities.
        _LEAGUE_AVG_ST_XG = 0.18
        _ST_PRIOR_OPPS = 30
        has_pp_xg_data = 'xG_pp_for' in team_games.columns and team_games['xG_pp_for'].sum() > 0
        if has_pp_xg_data:
            pp_xgf_per_opp = (team_games['xG_pp_for'].sum() + _ST_PRIOR_OPPS * _LEAGUE_AVG_ST_XG) / (pp_opps + _ST_PRIOR_OPPS)
            pk_xga_per_opp = (team_games['xG_pp_against'].sum() + _ST_PRIOR_OPPS * _LEAGUE_AVG_ST_XG) / (pk_opps + _ST_PRIOR_OPPS)
        else:
            pp_xgf_per_opp = _LEAGUE_AVG_ST_XG
            pk_xga_per_opp = _LEAGUE_AVG_ST_XG

        team_ratings[team] = {
            'xgf_rating': xgf_rating,
            'xga_rating': xga_rating,
            'xgf_rolling': rolling_xgf,
            'xga_rolling': rolling_xga,
            'xgf_5v5_rating': xgf_5v5_rating,
            'xga_5v5_rating': xga_5v5_rating,
            'pp_rating': pp_rating,
            'pk_rating': pk_rating,
            'pp_xgf_per_opp': round(pp_xgf_per_opp, 4),
            'pk_xga_per_opp': round(pk_xga_per_opp, 4),
            'penalties_drawn_per_60': penalties_drawn_per_game,
            'penalties_taken_per_60': penalties_taken_per_game,
            'games_played': games_played
        }
        
    # --- Goalie Ratings (Multi-Season with Bayesian Regression) ---
    #
    # Phase 2B improvements:
    #   1. Multi-season GSAx: weight current (50%) + prior (30%) + 2yr ago (20%)
    #   2. Bayesian regression: heavier shrinkage for goalies with fewer starts
    #   3. Output includes per-season breakdown for ML model consumption

    # Load historical gamestats for prior seasons
    hist_path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
    hist_df = None
    if os.path.exists(hist_path):
        hist_df = pd.read_csv(hist_path, low_memory=False)
        hist_df['game_date'] = pd.to_datetime(hist_df['game_date'])

    # Combine current + historical, deduplicate
    df['game_date'] = pd.to_datetime(df['game_date'])
    if hist_df is not None:
        all_games_df = pd.concat([hist_df, df], ignore_index=True)
        all_games_df = all_games_df.drop_duplicates(subset=['game_id', 'team'], keep='last')
    else:
        all_games_df = df.copy()

    # Season start year from the game id (2026020001 -> 2026)
    all_games_df['season'] = all_games_df['game_id'].map(season_of_game_id)
    current_season = all_games_df['season'].max()

    # Compute per-goalie, per-season GSAx
    goalie_season_stats = {}  # {goalie: {season: {xga, ga, games}}}

    for _, row in all_games_df.iterrows():
        goalie = row['starting_goalie']
        if pd.isna(goalie):
            continue
        season = row['season']
        xga = pd.to_numeric(row.get('xG_against', 0), errors='coerce') or 0
        ga = pd.to_numeric(row.get('goals_ag', 0), errors='coerce') or 0

        if goalie not in goalie_season_stats:
            goalie_season_stats[goalie] = {}
        if season not in goalie_season_stats[goalie]:
            goalie_season_stats[goalie][season] = {'xga': 0, 'ga': 0, 'games': 0}

        goalie_season_stats[goalie][season]['xga'] += xga
        goalie_season_stats[goalie][season]['ga'] += ga
        goalie_season_stats[goalie][season]['games'] += 1

    # Multi-season weighting & Bayesian regression
    SEASON_WEIGHTS = {0: 0.50, 1: 0.30, 2: 0.20}  # current, prior, 2yr ago
    BAYESIAN_PRIOR_STRENGTH = 20  # equivalent games of "average goalie" prior
    # A goalie with 20 GP gets 50% shrinkage; 40 GP gets 33%; 60 GP gets 25%

    goalie_ratings = {}

    for goalie, seasons_data in goalie_season_stats.items():
        # Compute weighted multi-season GSAx/game
        weighted_gsax_sum = 0.0
        weight_sum = 0.0
        total_games_all = 0
        current_season_games = 0
        current_season_gsax = 0.0

        for offset, weight in SEASON_WEIGHTS.items():
            s = current_season - offset
            if s in seasons_data:
                stats = seasons_data[s]
                gsax = stats['xga'] - stats['ga']
                gp = stats['games']
                if gp > 0:
                    gsax_pg = gsax / gp
                    weighted_gsax_sum += gsax_pg * weight
                    weight_sum += weight
                    total_games_all += gp
                    if offset == 0:
                        current_season_games = gp
                        current_season_gsax = gsax

        if weight_sum == 0 or total_games_all < 1:
            continue

        # Normalize weights to sum to 1 (handles missing seasons)
        raw_gsax_per_game = weighted_gsax_sum / weight_sum

        # Bayesian regression toward 0 (league-average goalie)
        # More regression for fewer current-season starts
        # Uses current season GP as the evidence strength, but never less than
        # 30% of multi-season GP so early-season starts don't erase past seasons
        evidence_games = max(current_season_games, total_games_all * 0.3)
        regressed_gsax_per_game = (raw_gsax_per_game * evidence_games) / (evidence_games + BAYESIAN_PRIOR_STRENGTH)

        goalie_ratings[goalie] = {
            'gsax_per_game': regressed_gsax_per_game,
            'gsax_per_game_raw': raw_gsax_per_game,
            'gsax_total': current_season_gsax,
            'games_played': current_season_games,
            'games_played_all': total_games_all,
            'seasons_tracked': len([s for s in seasons_data if seasons_data[s]['games'] > 0]),
            'regression_factor': round(evidence_games / (evidence_games + BAYESIAN_PRIOR_STRENGTH), 3),
        }

    print(f"  Goalie ratings: {len(goalie_ratings)} goalies, "
          f"{sum(1 for g in goalie_ratings.values() if g['seasons_tracked'] > 1)} multi-season")
        
    # Save to JSON
    if save_files:
        team_ratings_path = os.path.join(PUBLIC_DATA_DIR, 'team_ratings.json')
        goalie_ratings_path = os.path.join(PUBLIC_DATA_DIR, 'goalie_ratings.json')
        # Also save to pipeline dir so predict_games.py reads current data
        pipeline_tr_path = os.path.join(SCRIPT_DIR, 'team_ratings.json')
        pipeline_gr_path = os.path.join(SCRIPT_DIR, 'goalie_ratings.json')

        with open(team_ratings_path, 'w') as f:
            json.dump(team_ratings, f, indent=4)
        print(f"Saved team_ratings.json to {team_ratings_path}")
        with open(pipeline_tr_path, 'w') as f:
            json.dump(team_ratings, f, indent=4)
        print(f"Saved team_ratings.json to {pipeline_tr_path}")

        with open(goalie_ratings_path, 'w') as f:
            json.dump(goalie_ratings, f, indent=4)
        print(f"Saved goalie_ratings.json to {goalie_ratings_path}")
        with open(pipeline_gr_path, 'w') as f:
            json.dump(goalie_ratings, f, indent=4)
        print(f"Saved goalie_ratings.json to {pipeline_gr_path}")

        # Compute and save team_stats_extended.json (splits by time/location/starter)
        _save_extended_stats(df, PUBLIC_DATA_DIR)

    return team_ratings, goalie_ratings, league_xg_for, league_xg_5v5


def _save_extended_stats(df, public_data_dir):
    """Compute per-team stat splits and save to team_stats_extended.json."""
    import numpy as np
    df = df.copy()
    df['game_date'] = pd.to_datetime(df['game_date'])
    OLYMPICS_CUTOFF = pd.Timestamp('2026-02-22')
    WIN_RESULTS = {'RW', 'OTW', 'SOW', 'W'}
    OTL_RESULTS = {'OTL', 'SOL'}

    num_cols = ['goals_for','goals_ag','sog_for','sog_ag','xG_for','xG_against',
                'xG_for_5v5','xG_against_5v5','save_percentage',
                'control_score','pp_goals','pp_opportunities','pp_goals_against','pk_opportunities']
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0)

    def calc_pts_pct(group):
        wins = group['result'].isin(WIN_RESULTS).sum()
        otl = group['result'].isin(OTL_RESULTS).sum()
        gp = len(group)
        return round(float((wins * 2 + otl) / (gp * 2)), 4) if gp > 0 else 0.5

    def calc_stats(group):
        if group is None or len(group) == 0:
            return None
        gp = len(group)
        pp_opps = float(group['pp_opportunities'].sum())
        pk_opps = float(group['pk_opportunities'].sum())
        xgf5 = float(group['xG_for_5v5'].sum())
        xga5 = float(group['xG_against_5v5'].sum())
        sv_list = group['save_percentage'].replace(0, float('nan')).dropna()
        sv_pct = float(sv_list.mean()) if len(sv_list) > 0 else 0.90
        return {
            'gf_per_game': round(float(group['goals_for'].sum() / gp), 3),
            'ga_per_game': round(float(group['goals_ag'].sum() / gp), 3),
            'sf_per_game': round(float(group['sog_for'].sum() / gp), 2),
            'sa_per_game': round(float(group['sog_ag'].sum() / gp), 2),
            'pts_pct': calc_pts_pct(group),
            'sv_pct': round(sv_pct, 4),
            'xg_delta': round(float(xgf5 / gp - xga5 / gp), 4),
            'xg_pct': round(float(xgf5 / (xgf5 + xga5)), 4) if (xgf5 + xga5) > 0 else 0.5,
            'control': round(float(group['control_score'].mean()), 4),
            'xgf_5v5': round(float(xgf5 / gp), 4),
            'xga_5v5': round(float(xga5 / gp), 4),
            'pp': round(float(group['pp_goals'].sum() / pp_opps * 100), 2) if pp_opps > 0 else 0,
            'pk': round(float((1 - group['pp_goals_against'].sum() / pk_opps) * 100), 2) if pk_opps > 0 else 0,
            'pen_drawn': round(float(pp_opps / gp), 4),
            'pen_taken': round(float(pk_opps / gp), 4),
            'games': int(gp),
        }

    result = {}
    for team, tg in df.groupby('team'):
        tg = tg.sort_values('game_date')
        since = tg[tg['game_date'] >= OLYMPICS_CUTOFF]
        home = tg[tg['home_away'] == 'Home']
        away = tg[tg['home_away'] == 'Away']
        by_goalie = {}
        for goalie, gg in tg.groupby('starting_goalie'):
            if isinstance(goalie, str) and goalie.strip():
                gs = calc_stats(gg)
                if gs and gs['games'] >= 5:
                    by_goalie[goalie] = gs
        home_since = since[since['home_away'] == 'Home']
        away_since = since[since['home_away'] == 'Away']
        by_goalie_since = {}
        for goalie, gg in tg.groupby('starting_goalie'):
            if isinstance(goalie, str) and goalie.strip():
                gs_since = calc_stats(gg[gg['game_date'] >= OLYMPICS_CUTOFF])
                if gs_since and gs_since['games'] >= 3:
                    by_goalie_since[goalie] = gs_since
        result[team] = {
            'all': calc_stats(tg),
            'since_olympics': calc_stats(since),
            'home': calc_stats(home),
            'away': calc_stats(away),
            'home_since_olympics': calc_stats(home_since),
            'away_since_olympics': calc_stats(away_since),
            'by_goalie': by_goalie,
            'by_goalie_since_olympics': by_goalie_since,
        }

    out_path = os.path.join(public_data_dir, 'team_stats_extended.json')
    with open(out_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"Saved team_stats_extended.json ({len(result)} teams)")

if __name__ == "__main__":
    calculate_ratings()
