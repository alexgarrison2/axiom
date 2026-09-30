"""
team_ratings.py - team power ratings and goalie ratings for the site.

Team xG ratings: 50% recent form + 50% season average regressed toward last
season's regressed rating (PRIOR_KEEP), NHL game types 02/03 only.

Special teams (C6): the displayed PP% / PK% are REGRESSED rates,
    (goals + ST_PRIOR_OPPS * league rate) / (opportunities + ST_PRIOR_OPPS),
so one 1-for-2 night reads ~21%, not 50%.  The raw season rate and the
opportunity counts are published next to it (pp_pct_actual, pp_opportunities).

Goalie ratings (C6) come from the same FeatureState the game model uses
(features.py): shot-level raw xG with empty-net shots removed, normalised
within each season so league GSAx is zero, the current season blended with
the prior two by w_cur = gp_cur / (gp_cur + 30), shrunk by weighted GP, and
only NHL regular-season / playoff games.  gsax_per_game is a per-game rate for
the season named in ``season``.
"""
from season import season_file, PREV_START_YEAR, season_of_game_id, START_YEAR, SEASON_LABEL
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
NHL_GAME_TYPES = ('02', '03')
# Special teams: regress PP% / PK% toward the league rate with this many
# opportunities (~20 games of power plays).
ST_PRIOR_OPPS = 60
DEFAULT_LEAGUE_PP = 0.20


def nhl_games_only(df):
    """Drop All-Star (04), PWHL showcase (12) and 4 Nations (19/20) rows."""
    if df is None or df.empty or 'game_id' not in df.columns:
        return df
    return df[df['game_id'].astype(str).str[4:6].isin(NHL_GAME_TYPES)].copy()


def league_pp_rate(df, prior_df=None):
    """League PP conversion this season, blended with last season's (prior
    worth 32 * ST_PRIOR_OPPS opportunities)."""
    def totals(d):
        if d is None or d.empty or 'pp_goals' not in d.columns:
            return 0.0, 0.0
        return (float(pd.to_numeric(d['pp_goals'], errors='coerce').fillna(0).sum()),
                float(pd.to_numeric(d['pp_opportunities'], errors='coerce').fillna(0).sum()))
    g, o = totals(df)
    pg, po = totals(prior_df)
    prior_rate = pg / po if po > 0 else DEFAULT_LEAGUE_PP
    k = 32 * ST_PRIOR_OPPS
    return (g + k * prior_rate) / (o + k)


def regressed_rate(successes, opps, league_rate, k=ST_PRIOR_OPPS):
    return (successes + k * league_rate) / (opps + k)


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

    df = nhl_games_only(df)
    prior_league, priors = team_priors(prior_df) if prior_df is not None else (None, {})
    league_pp = league_pp_rate(df, prior_df)

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

        
        # Special teams: regressed rates for display (C6), raw rates alongside.
        num = lambda c: float(pd.to_numeric(team_games[c], errors='coerce').fillna(0).sum()) if c in team_games else 0.0
        pp_goals, pp_opps = num('pp_goals'), num('pp_opportunities')
        pk_goals_ag, pk_opps = num('pp_goals_against'), num('pk_opportunities')
        pp_rating = 100 * regressed_rate(pp_goals, pp_opps, league_pp)
        pk_rating = 100 * (1 - regressed_rate(pk_goals_ag, pk_opps, league_pp))
        pp_pct_actual = 100 * pp_goals / pp_opps if pp_opps > 0 else None
        pk_pct_actual = 100 * (1 - pk_goals_ag / pk_opps) if pk_opps > 0 else None
        # Penalties drawn / taken per game, regressed toward ~3 with REGRESSION_GAMES of weight
        penalties_drawn_per_game = (pp_opps + REGRESSION_GAMES * 3.0) / (games_played + REGRESSION_GAMES)
        penalties_taken_per_game = (pk_opps + REGRESSION_GAMES * 3.0) / (games_played + REGRESSION_GAMES)

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
            'pp_pct_actual': pp_pct_actual,
            'pk_pct_actual': pk_pct_actual,
            'pp_goals': int(pp_goals),
            'pp_opportunities': int(pp_opps),
            'pk_goals_against': int(pk_goals_ag),
            'pk_opportunities': int(pk_opps),
            'league_pp_pct': 100 * league_pp,
            'st_prior_opps': ST_PRIOR_OPPS,
            'season': SEASON_LABEL,
            'pp_xgf_per_opp': round(pp_xgf_per_opp, 4),
            'pk_xga_per_opp': round(pk_xga_per_opp, 4),
            'penalties_drawn_per_60': penalties_drawn_per_game,
            'penalties_taken_per_60': penalties_taken_per_game,
            'games_played': games_played
        }
        
    # --- Goalie Ratings (C6): the game model's own goalie state ---
    goalie_ratings = compute_goalie_ratings(df)
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

        # Compute and save team_stats_extended.json (splits by time/location/starter).
        # Before the season's first game there is nothing to split: keep the file.
        if len(df):
            _save_extended_stats(df, PUBLIC_DATA_DIR)
        else:
            print("No games this season yet - team_stats_extended.json left unchanged")

    return team_ratings, goalie_ratings, league_xg_for, league_xg_5v5


def compute_goalie_ratings(current_df=None, season=START_YEAR, pipeline_dir=SCRIPT_DIR):
    """{goalie: rating row} for everyone who started in ``season`` or the two
    before it, from features.FeatureState (same numbers the model uses)."""
    import features as F
    cur = current_df if current_df is not None and len(current_df) else None
    games, _ = F.load_feature_games(pipeline_dir, current_df=cur)
    st = F.build_state(games)
    st.ensure_season_for_date(None, season=season)
    label = f"{season}-{str(season + 1)[2:]}"
    out = {}
    for name, by in st.goalies.items():
        recent = {s: v for s, v in by.items() if season - 2 <= s <= season and v.gp > 0}
        if not recent:
            continue
        b = st.goalie_breakdown(name, season)
        out[name] = {
            'season': label,
            'gsax_per_game': b['rating'],
            'gsax_per_game_raw': b['raw'],
            'gsax_per_game_season': b['cur_rate'] if b['gp_cur'] else None,
            'gsax_per_game_prior': b['prior_rate'] if b['prior_gp_weighted'] else None,
            'gsax_total': b['gsax_cur'],
            'games_played': b['gp_cur'],
            'games_played_all': int(sum(v.gp for v in recent.values())),
            'games_by_season': {f"{s}-{str(s + 1)[2:]}": v.gp for s, v in sorted(recent.items())},
            'seasons_tracked': len(recent),
            'evidence_gp': b['evidence_gp'],
            'w_current': b['w_cur'],
            'regression_factor': round(b['shrink'], 3),
        }
    return out


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
