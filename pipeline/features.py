#!/usr/bin/env python3
"""
features.py - the ONE pregame feature builder shared by training and serving.

Why this exists
---------------
Training (train_game_model.py) and serving (ml_predict.py) used to compute
features with two different code paths: career vs. season goalie GP/GSAx, a
games_played off-by-one, a 0.5 win-rate default that never appeared in
training, and an early return on opening night that skipped the historical
carryover.  Everything now goes through ``FeatureState``:

* ``FeatureState.update(day_games)`` folds one day of completed games into the
  running state (team strength EWMAs, Elo, points, goalie GSAx, schedule).
* ``FeatureState.pregame(home, away, date, ...)`` returns the feature dict for
  a game using only what the state has seen.
* ``build_training_matrix`` replays history date by date: for each date it
  asks ``pregame`` for every game BEFORE folding that date's results in.  A
  serving call with the same history therefore returns exactly the training
  row (tests/test_features.py checks 50 random games to 1e-9).

Data hygiene
------------
* Only NHL regular-season (02) and playoff (03) games; All-Star (04), PWHL
  showcase (12) and 4 Nations (19/20) rows are dropped everywhere.
* xG is the RAW shot-model output (no shooting-talent multiplier, which used
  future goals), re-aggregated from the shot files with empty-net shots
  removed.  Shot files that already carry an ``xg_raw`` column use it
  directly; otherwise shots are re-scored with ``xg_model_xgb.pkl``.
* xG levels are normalised per season so league xG equals league goals, using
  only games played so far that season (with a prior from last season), so no
  future information leaks into a pregame feature.
* A season boundary regresses every team's strength toward the league mean
  (``OFFSEASON_KEEP``) instead of carrying last season's form raw, and Elo
  regresses by ``ELO_OFFSEASON_REGRESSION``.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(SCRIPT_DIR, 'cache')

NHL_GAME_TYPES = ('02', '03')

# Franchise continuity: ratings carry across relocations / renames.
FRANCHISE_ALIASES = {
    'Coyotes': 'Mammoth',
    'Utah Hockey Club': 'Mammoth',
    'Utah': 'Mammoth',
}
# Shot files carry NHL team ids; a few are not in the current nhl_teams.csv.
EXTRA_TEAM_IDS = {53: 'Coyotes', 59: 'Utah Hockey Club'}

WIN_RESULTS = ('RW', 'OTW', 'SOW', 'W')
OTL_RESULTS = ('OTL', 'SOL')

# ─── Hyper-parameters (fitted by retrain.py --tune; see game_model_meta.json) ──
XG_HALFLIFE = 16             # games; EWMA of 5v5 xG share
OFFSEASON_KEEP = 0.5          # share of a team's deviation carried into a new season
PTS_PRIOR_GAMES = 20          # shrunk points%: (pts/2 + k*0.5) / (GP + k)
ELO_K = 4.0
ELO_KX = 4.0                  # xG-share term in the Elo update
ELO_HFA = 35.0
ELO_OFFSEASON_REGRESSION = 0.5
GOALIE_CUR_PRIOR_GP = 30      # w_cur = gp_cur / (gp_cur + 30)
GOALIE_SHRINK_GP = 25         # rating *= ev / (ev + 25), ev = weighted GP
GOALIE_SEASON_DECAY = (1.0, 0.5)   # weights of seasons s-1, s-2 in the prior
XG_NORM_PRIOR_GOALS = 1000.0  # shrink in-season normalisation factor to last season's
REST_CAP = 4
PACE_HALFLIFE = 20            # games; EWMA of goals for/against (total-goals model)

FEATURE_COLUMNS = [
    'd_xg_share',       # home minus away 5v5 xG-share EWMA (regressed across seasons)
    'd_xg_share_all',   # same, all situations (adds special-teams play)
    'd_elo',            # (Elo_home - Elo_away) / 100
    'd_goalie_gsax',    # regressed GSAx / game of the starters (home - away)
    'd_pts_pct',        # shrunk points% (home - away)
    'h_b2b', 'a_b2b',   # second night of a back-to-back
    'd_rest',           # capped rest-day difference
]

CANDIDATE_COLUMNS = [
    'd_st',             # special-teams xG net per game
    'd_travel_km', 'h_tz_shift', 'a_tz_shift',  # C10 candidates
]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def game_type_of(game_id) -> str:
    return str(game_id)[4:6]


def season_of(game_id) -> int:
    return int(str(game_id)[:4])


def _norm_name(name: str) -> str:
    import unicodedata
    n = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode()
    return ' '.join(''.join(ch if ch.isalnum() or ch == ' ' else ' ' for ch in n.lower()).split())


def franchise(team: str) -> str:
    return FRANCHISE_ALIASES.get(team, team)


def _logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def load_team_ids(pipeline_dir=SCRIPT_DIR) -> dict:
    teams = pd.read_csv(os.path.join(pipeline_dir, 'nhl_teams.csv'))
    m = {int(r['NHL Team ID']): r['Common Name'] for _, r in teams.iterrows()}
    m.update(EXTRA_TEAM_IDS)
    return m


# ─── Arena coordinates (static; C10 travel / timezone candidates) ────────────
# lat, lon, standard UTC offset (hours) of each franchise's home arena.
ARENAS = {
    'Ducks': (33.808, -117.877, -8), 'Bruins': (42.366, -71.062, -5),
    'Sabres': (42.875, -78.876, -5), 'Flames': (51.037, -114.052, -7),
    'Hurricanes': (35.803, -78.722, -5), 'Blackhawks': (41.881, -87.674, -6),
    'Avalanche': (39.749, -105.008, -7), 'Blue Jackets': (39.969, -83.006, -5),
    'Stars': (32.790, -96.810, -6), 'Red Wings': (42.341, -83.055, -5),
    'Oilers': (53.547, -113.498, -7), 'Panthers': (26.158, -80.326, -5),
    'Kings': (34.043, -118.267, -8), 'Wild': (44.945, -93.101, -6),
    'Canadiens': (45.496, -73.569, -5), 'Predators': (36.159, -86.778, -6),
    'Devils': (40.734, -74.171, -5), 'Islanders': (40.723, -73.590, -5),
    'Rangers': (40.751, -73.994, -5), 'Senators': (45.297, -75.927, -5),
    'Flyers': (39.901, -75.172, -5), 'Penguins': (40.439, -79.989, -5),
    'Sharks': (37.333, -121.901, -8), 'Kraken': (47.622, -122.354, -8),
    'Blues': (38.627, -90.203, -6), 'Lightning': (27.943, -82.452, -5),
    'Maple Leafs': (43.643, -79.379, -5), 'Mammoth': (40.768, -111.901, -7),
    'Canucks': (49.278, -123.109, -8), 'Golden Knights': (36.103, -115.178, -8),
    'Capitals': (38.898, -77.021, -5), 'Jets': (49.893, -97.144, -6),
}
# Arizona played in Tempe before the move.
ARENA_OVERRIDES_BY_TEAM_NAME = {'Coyotes': (33.426, -111.933, -7)}


def _arena(team_name):
    if team_name in ARENA_OVERRIDES_BY_TEAM_NAME:
        return ARENA_OVERRIDES_BY_TEAM_NAME[team_name]
    return ARENAS.get(franchise(team_name))


def _haversine_km(a, b):
    if a is None or b is None:
        return 0.0
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


# ─── Game loading ─────────────────────────────────────────────────────────────

def load_gamestats(pipeline_dir=SCRIPT_DIR, include_current=True, current_df=None) -> pd.DataFrame:
    """Historical + current-season team-game rows, NHL games only, deduped.

    ``current_df`` lets callers pass the season frame they already loaded
    (possibly empty on opening night).  The historical file is ALWAYS loaded.
    """
    frames = []
    hist = os.path.join(pipeline_dir, 'nhl_historical_gamestats.csv')
    if os.path.exists(hist):
        frames.append(pd.read_csv(hist, low_memory=False))
    if current_df is not None:
        if len(current_df):
            frames.append(current_df)
    elif include_current:
        from season import season_file, START_YEAR
        for sy in (START_YEAR - 1, START_YEAR):
            p = os.path.join(pipeline_dir, season_file('gamestats', sy))
            if os.path.exists(p):
                frames.append(pd.read_csv(p, low_memory=False))
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset=['game_id', 'team'], keep='last')
    df = df[df['game_id'].astype(str).str[4:6].isin(NHL_GAME_TYPES)].copy()
    df = df[df['result'].notna() & (df['result'].astype(str) != '')]
    df['game_date'] = pd.to_datetime(df['game_date']).dt.normalize()
    df['season'] = df['game_id'].map(season_of)
    for c in ('goals_for', 'goals_ag', 'xG_for', 'xG_against', 'xG_for_5v5', 'xG_against_5v5',
              'pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities',
              'xG_pp_for', 'xG_pp_against'):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors='coerce')
    return df.sort_values(['game_date', 'game_id', 'home_away']).reset_index(drop=True)


def _shot_files(pipeline_dir):
    from season import season_file, START_YEAR
    files = [os.path.join(pipeline_dir, 'nhl_historical_shots.csv')]
    for sy in (START_YEAR - 1, START_YEAR):
        files.append(os.path.join(pipeline_dir, season_file('shots', sy)))
    return [f for f in files if os.path.exists(f)]


def _score_raw_xg(shots: pd.DataFrame, pipeline_dir) -> pd.Series:
    """Raw shot-model xG (no talent multiplier, no normalisation)."""
    if 'xg_raw' in shots.columns and shots['xg_raw'].notna().any():
        return pd.to_numeric(shots['xg_raw'], errors='coerce')
    import pickle
    import sys
    if pipeline_dir not in sys.path:
        sys.path.insert(0, pipeline_dir)
    cwd = os.getcwd()
    try:
        os.chdir(pipeline_dir)  # preprocess_data reads player_hand.json relative to cwd
        from xg_model import preprocess_data
        import contextlib
        import io
        with open(os.path.join(pipeline_dir, 'xg_model_xgb.pkl'), 'rb') as f:
            model = pickle.load(f)
        with contextlib.redirect_stdout(io.StringIO()):
            X, _ = preprocess_data(shots)
        out = pd.Series(np.nan, index=shots.index)
        if len(X):
            out.loc[X.index] = model.predict_proba(X)[:, 1]
        return out
    finally:
        os.chdir(cwd)


def raw_team_game_xg(pipeline_dir=SCRIPT_DIR, use_cache=True) -> pd.DataFrame | None:
    """Per (game_id, team): raw xG for/against (all situations and 5v5), excluding
    empty-net shots, plus non-empty-net goals against (for goalie GSAx).

    Returns None if no shot files / xG model are available (callers then fall
    back to the xG columns already in the gamestats file)."""
    files = _shot_files(pipeline_dir)
    if not files:
        return None
    sig = '|'.join(f"{os.path.basename(f)}:{os.path.getsize(f)}:{int(os.path.getmtime(f))}" for f in files)
    model_path = os.path.join(pipeline_dir, 'xg_model_xgb.pkl')
    if os.path.exists(model_path):
        sig += f"|model:{os.path.getsize(model_path)}:{int(os.path.getmtime(model_path))}"
    cache_path = os.path.join(CACHE_DIR, 'raw_team_game_xg.csv')
    sig_path = cache_path + '.sig'
    if use_cache and os.path.exists(cache_path) and os.path.exists(sig_path):
        with open(sig_path) as f:
            if f.read() == sig:
                return pd.read_csv(cache_path)

    team_ids = load_team_ids(pipeline_dir)
    parts = []
    usecols = None
    for f in files:
        head = pd.read_csv(f, nrows=0)
        if head.empty and len(head.columns) == 0:
            continue
        s = pd.read_csv(f, low_memory=False)
        if s.empty:
            continue
        s = s[s['game_id'].astype(str).str[4:6].isin(NHL_GAME_TYPES)]
        try:
            s['xg_raw_'] = _score_raw_xg(s, pipeline_dir)
        except Exception as e:  # model missing / incompatible
            print(f"[features] raw xG scoring failed for {os.path.basename(f)}: {e}")
            return None
        s = s[s['event_type'].isin([505, 506, 507])] if 'event_type' in s.columns else s
        parts.append(s[['game_id', 'team_id', 'strength_state', 'is_goal', 'xg_raw_']])
    if not parts:
        return None
    s = pd.concat(parts, ignore_index=True).drop_duplicates()
    s['team'] = s['team_id'].map(team_ids)
    s = s.dropna(subset=['team'])
    s['en'] = s['strength_state'].eq('EmptyNet')
    s['is5'] = s['strength_state'].eq('5v5')
    s['is_goal'] = pd.to_numeric(s['is_goal'], errors='coerce').fillna(0)
    ne = s[~s['en']]
    g = ne.groupby(['game_id', 'team']).agg(
        xgf_all=('xg_raw_', 'sum'),
        gf_noen=('is_goal', 'sum'),
    )
    g5 = ne[ne['is5']].groupby(['game_id', 'team'])['xg_raw_'].sum().rename('xgf_5v5')
    g = g.join(g5).fillna({'xgf_5v5': 0.0}).reset_index()
    # Opponent view: each game has exactly two teams.
    opp = g.rename(columns={'team': 'opp', 'xgf_all': 'xga_all', 'gf_noen': 'ga_noen', 'xgf_5v5': 'xga_5v5'})
    m = g.merge(opp, on='game_id')
    m = m[m['team'] != m['opp']].drop(columns=['opp'])
    os.makedirs(CACHE_DIR, exist_ok=True)
    gi = os.path.join(CACHE_DIR, '.gitignore')
    if not os.path.exists(gi):
        with open(gi, 'w') as f:
            f.write('*\n')
    m.to_csv(cache_path, index=False)
    with open(sig_path, 'w') as f:
        f.write(sig)
    return m


def attach_raw_xg(games: pd.DataFrame, raw: pd.DataFrame | None) -> tuple[pd.DataFrame, str]:
    """Add columns rxgf_all, rxga_all, rxgf_5v5, rxga_5v5, ga_noen to games.
    Rows without shot data fall back to the gamestats xG columns."""
    g = games.copy()
    source = 'gamestats_xg'
    if raw is not None and len(raw):
        g = g.merge(raw, on=['game_id', 'team'], how='left')
        source = 'raw_shot_xg'
    for col in ('xgf_all', 'xga_all', 'xgf_5v5', 'xga_5v5', 'ga_noen'):
        if col not in g.columns:
            g[col] = np.nan
    en_ag = pd.to_numeric(g.get('emptynet_goalsagainst', 0), errors='coerce').fillna(0)
    g['rxgf_all'] = g['xgf_all'].fillna(g['xG_for'])
    g['rxga_all'] = g['xga_all'].fillna(g['xG_against'])
    g['rxgf_5v5'] = g['xgf_5v5'].fillna(g['xG_for_5v5'])
    g['rxga_5v5'] = g['xga_5v5'].fillna(g['xG_against_5v5'])
    g['ga_noen'] = g['ga_noen'].fillna(g['goals_ag'] - en_ag)
    return g, source


def load_feature_games(pipeline_dir=SCRIPT_DIR, current_df=None, use_raw_xg=True):
    games = load_gamestats(pipeline_dir, current_df=current_df)
    raw = raw_team_game_xg(pipeline_dir) if use_raw_xg else None
    return attach_raw_xg(games, raw)


# ─── State ────────────────────────────────────────────────────────────────────

@dataclass
class TeamState:
    xg_share: float = 0.5        # EWMA of 5v5 xG share
    xg_share_all: float = 0.5
    st_net: float = 0.0          # EWMA of PP xG - PK xGA per game (normalised)
    gf: float = 3.05             # EWMA goals for / game (scoring pace; goal model only)
    ga: float = 3.05             # EWMA goals against / game
    elo: float = 1500.0
    gp: int = 0                  # games this season (02+03)
    pts2: float = 0.0            # points / 2 this season (W + 0.5*OTL), regular season
    rs_gp: int = 0
    last_date: pd.Timestamp | None = None
    last_venue: tuple | None = None


@dataclass
class GoalieSeason:
    xga: float = 0.0      # normalised non-EN xG faced
    ga: float = 0.0       # non-EN goals allowed
    gp: int = 0


@dataclass
class FeatureState:
    season: int | None = None
    teams: dict = field(default_factory=dict)
    goalies: dict = field(default_factory=dict)   # name -> {season: GoalieSeason}
    season_goals: float = 0.0
    season_xg: float = 0.0
    prev_norm: float = 1.0
    league_total_goals: float = 0.0   # this season, regulation+OT goals (no SO goal)
    league_games: int = 0
    prev_league_gpg: float = 6.1
    n_updates: int = 0

    # --- season handling ---------------------------------------------------
    def _team(self, name) -> TeamState:
        key = franchise(name)
        if key not in self.teams:
            self.teams[key] = TeamState()
        return self.teams[key]

    def norm_factor(self) -> float:
        """League goals / league xG so far this season, shrunk to last season's."""
        p = XG_NORM_PRIOR_GOALS
        return (self.season_goals + p * self.prev_norm) / (self.season_xg + p)

    def league_gpg(self) -> float:
        prior_games = 100
        return (self.league_total_goals + prior_games * self.prev_league_gpg) / (self.league_games + prior_games)

    def start_season(self, season: int):
        if self.season is not None and season != self.season:
            if self.season_xg > 0:
                self.prev_norm = self.norm_factor()
            if self.league_games > 0:
                self.prev_league_gpg = self.league_total_goals / self.league_games
            for t in self.teams.values():
                t.xg_share = 0.5 + OFFSEASON_KEEP * (t.xg_share - 0.5)
                t.xg_share_all = 0.5 + OFFSEASON_KEEP * (t.xg_share_all - 0.5)
                t.st_net = OFFSEASON_KEEP * t.st_net
                half = self.prev_league_gpg / 2
                t.gf = half + OFFSEASON_KEEP * (t.gf - half)
                t.ga = half + OFFSEASON_KEEP * (t.ga - half)
                t.elo = 1500.0 + (1 - ELO_OFFSEASON_REGRESSION) * (t.elo - 1500.0)
                t.gp = 0
                t.pts2 = 0.0
                t.rs_gp = 0
            self.season_goals = 0.0
            self.season_xg = 0.0
            self.league_total_goals = 0.0
            self.league_games = 0
        self.season = season

    def ensure_season_for_date(self, game_date, season=None):
        """Roll the state into ``season`` (derived from the date if None)."""
        if season is None:
            d = pd.Timestamp(game_date)
            season = d.year if d.month >= 7 else d.year - 1
        if self.season is None or season > self.season:
            self.start_season(season)

    # --- goalie rating ---------------------------------------------------------
    def resolve_goalie(self, name):
        """Match a (possibly differently spelled) goalie name to the state.
        Exact -> accent/punctuation-insensitive -> unique 'F. Lastname'."""
        if not name or not isinstance(name, str):
            return None
        name = name.strip()
        if name in self.goalies:
            return name
        key = _norm_name(name)
        cands = [g for g in self.goalies if _norm_name(g) == key]
        if len(cands) == 1:
            return cands[0]
        parts = key.split()
        if len(parts) >= 2 and len(parts[0]) == 1:   # abbreviated 'F. Lastname' only
            first, last = parts[0][0], parts[-1]
            cands = [g for g in self.goalies
                     if _norm_name(g).split()[-1:] == [last] and _norm_name(g)[:1] == first]
            if len(cands) == 1:
                return cands[0]
        return None


    def goalie_rating(self, name, season=None) -> tuple[float, float, int]:
        """(regressed GSAx/game, weighted GP evidence, current-season GP)."""
        season = self.season if season is None else season
        name = self.resolve_goalie(name)
        if name is None:
            return 0.0, 0.0, 0
        by = self.goalies[name]
        cur = by.get(season, GoalieSeason())
        cur_rate = (cur.xga - cur.ga) / cur.gp if cur.gp else 0.0
        p_gsax = p_gp = 0.0
        for k, w in enumerate(GOALIE_SEASON_DECAY, start=1):
            s = by.get(season - k)
            if s and s.gp:
                p_gsax += w * (s.xga - s.ga)
                p_gp += w * s.gp
        prior_rate = p_gsax / p_gp if p_gp else 0.0
        if p_gp == 0:
            raw = cur_rate
        else:
            w_cur = cur.gp / (cur.gp + GOALIE_CUR_PRIOR_GP)
            raw = w_cur * cur_rate + (1 - w_cur) * prior_rate
        ev = cur.gp + p_gp
        return raw * ev / (ev + GOALIE_SHRINK_GP), ev, cur.gp

    # --- update ---------------------------------------------------------------
    def update(self, day: pd.DataFrame):
        """Fold one day of completed team-game rows into the state."""
        if day.empty:
            return
        for _, pairs in paired_days(day):
            self.update_pairs(pairs)

    def update_pairs(self, pairs):
        """Fold one day's completed games, given as [(home_row, away_row), ...]."""
        if not pairs:
            return
        for season in sorted({int(h.season) for h, _ in pairs}):
            self.ensure_season_for_date(None, season=season)
        # Normalisation factor for this day's goalie updates uses the state
        # BEFORE the day (consistent with what pregame features saw).
        norm = self.norm_factor()
        for h, a in pairs:
            self._update_game(h, a, norm)
        # League totals after the day.
        for h, a in pairs:
            for r in (h, a):
                self.season_goals += float(r.ga_noen) if not pd.isna(r.ga_noen) else 0.0
                self.season_xg += float(r.rxga_all) if not pd.isna(r.rxga_all) else 0.0
        self.n_updates += 1

    def _update_game(self, h, a, norm):
        ht, at = self._team(h.team), self._team(h.opponent)
        # xG shares
        alpha = 1 - 0.5 ** (1 / XG_HALFLIFE)

        def share(f, ag):
            f = 0.0 if pd.isna(f) else float(f)
            ag = 0.0 if pd.isna(ag) else float(ag)
            return f / (f + ag) if (f + ag) > 0 else None

        s5 = share(h.rxgf_5v5, h.rxga_5v5)
        if s5 is not None:
            ht.xg_share += alpha * (s5 - ht.xg_share)
            at.xg_share += alpha * ((1 - s5) - at.xg_share)
        sa = share(h.rxgf_all, h.rxga_all)
        if sa is not None:
            ht.xg_share_all += alpha * (sa - ht.xg_share_all)
            at.xg_share_all += alpha * ((1 - sa) - at.xg_share_all)
        # special teams net (PP xG for - PK xG against), home and away rows
        for row, t in ((h, ht), (a, at)):
            ppf = getattr(row, 'xG_pp_for', np.nan)
            ppa = getattr(row, 'xG_pp_against', np.nan)
            if not (pd.isna(ppf) or pd.isna(ppa)):
                t.st_net += alpha * (norm * (float(ppf) - float(ppa)) - t.st_net)

        # Scoring pace (goals incl. empty net; the SO 'goal' is not counted)
        ap = 1 - 0.5 ** (1 / PACE_HALFLIFE)
        hg = 0.0 if pd.isna(h.goals_for) else float(h.goals_for)
        agl = 0.0 if pd.isna(h.goals_ag) else float(h.goals_ag)
        ht.gf += ap * (hg - ht.gf); ht.ga += ap * (agl - ht.ga)
        at.gf += ap * (agl - at.gf); at.ga += ap * (hg - at.ga)

        # Elo (goals with margin of victory + xG-share term)
        y = 1.0 if h.result in WIN_RESULTS else 0.0
        gd = (0 if pd.isna(h.goals_for) else h.goals_for) - (0 if pd.isna(h.goals_ag) else h.goals_ag)
        p = 1 / (1 + 10 ** (-(ht.elo - at.elo + ELO_HFA) / 400))
        d = ELO_K * (math.log1p(abs(gd)) + 0.5) * (y - p)
        if s5 is not None:
            d += ELO_KX * (s5 - 0.5) * 2
        ht.elo += d
        at.elo -= d

        # Points (regular season only), GP, schedule
        gtype = game_type_of(h.game_id)
        for row, t in ((h, ht), (a, at)):
            t.gp += 1
            if gtype == '02':
                t.rs_gp += 1
                if row.result in WIN_RESULTS:
                    t.pts2 += 1.0
                elif row.result in OTL_RESULTS:
                    t.pts2 += 0.5
            t.last_date = pd.Timestamp(row.game_date)
            t.last_venue = _arena(h.team)

        # Goalies (starter credited; EN excluded; xG normalised in-season)
        season = int(h.season)
        for row in (h, a):
            gname = row.starting_goalie
            if not isinstance(gname, str) or not gname:
                continue
            gs = self.goalies.setdefault(gname, {}).setdefault(season, GoalieSeason())
            xga = 0.0 if pd.isna(row.rxga_all) else float(row.rxga_all)
            ga = 0.0 if pd.isna(row.ga_noen) else float(row.ga_noen)
            gs.xga += norm * xga
            gs.ga += ga
            gs.gp += 1

        # League scoring pace
        tot = (0 if pd.isna(h.goals_for) else h.goals_for) + (0 if pd.isna(h.goals_ag) else h.goals_ag)
        self.league_total_goals += float(tot)
        self.league_games += 1

    def _pace(self, ht, at) -> float:
        """Relative scoring environment of a matchup (1.0 = league average)."""
        half = self.league_gpg() / 2
        if half <= 0:
            return 1.0
        oh, dh, oa, da = ht.gf / half, ht.ga / half, at.gf / half, at.ga / half
        return float((oh * da + oa * dh) / 2)

    # --- features ---------------------------------------------------------------
    def pregame(self, home, away, game_date, h_goalie=None, a_goalie=None,
                h_rest_days=None, a_rest_days=None, season=None) -> dict:
        """Feature dict for one game, using only what the state has seen.

        rest days default to (game_date - last game date) from the state;
        callers that know tonight's schedule (next-day games) pass overrides.
        """
        self.ensure_season_for_date(game_date, season)
        gd = pd.Timestamp(game_date).normalize()
        ht, at = self._team(home), self._team(away)

        def rest(t, override):
            if override is not None:
                return float(override)
            if t.last_date is None:
                return float(REST_CAP)
            return float(max(0, (gd - t.last_date).days))

        h_rest, a_rest = rest(ht, h_rest_days), rest(at, a_rest_days)
        hg, h_ev, h_gp = self.goalie_rating(h_goalie)
        ag, a_ev, a_gp = self.goalie_rating(a_goalie)
        k = PTS_PRIOR_GAMES
        h_pts = (ht.pts2 + 0.5 * k) / (ht.rs_gp + k)
        a_pts = (at.pts2 + 0.5 * k) / (at.rs_gp + k)

        venue = _arena(home)
        h_km = _haversine_km(ht.last_venue, venue) if ht.last_venue else 0.0
        a_km = _haversine_km(at.last_venue, venue) if at.last_venue else 0.0
        h_tz = (venue[2] - ht.last_venue[2]) if (ht.last_venue and venue) else 0
        a_tz = (venue[2] - at.last_venue[2]) if (at.last_venue and venue) else 0
        recent = lambda r: 1.0 if r <= 2 else 0.0  # travel only matters on short rest

        return {
            'd_xg_share': ht.xg_share - at.xg_share,
            'd_xg_share_all': ht.xg_share_all - at.xg_share_all,
            'd_elo': (ht.elo - at.elo) / 100.0,
            'd_goalie_gsax': hg - ag,
            'd_pts_pct': h_pts - a_pts,
            'h_b2b': 1.0 if h_rest == 1 else 0.0,
            'a_b2b': 1.0 if a_rest == 1 else 0.0,
            'd_rest': min(h_rest, REST_CAP) - min(a_rest, REST_CAP),
            'd_st': ht.st_net - at.st_net,
            'd_travel_km': (h_km * recent(h_rest) - a_km * recent(a_rest)) / 1000.0,
            'h_tz_shift': abs(h_tz) * recent(h_rest),
            'a_tz_shift': abs(a_tz) * recent(a_rest),
            # context (not model inputs)
            'h_gp': float(ht.gp), 'a_gp': float(at.gp),
            'h_rs_gp': float(ht.rs_gp), 'a_rs_gp': float(at.rs_gp),
            'h_goalie_gsax': hg, 'a_goalie_gsax': ag,
            'h_goalie_ev': h_ev, 'a_goalie_ev': a_ev,
            'h_goalie_gp': float(h_gp), 'a_goalie_gp': float(a_gp),
            'h_xg_share': ht.xg_share, 'a_xg_share': at.xg_share,
            'h_elo': ht.elo, 'a_elo': at.elo,
            'h_pts_pct': h_pts, 'a_pts_pct': a_pts,
            'h_rest': h_rest, 'a_rest': a_rest,
            'league_gpg': self.league_gpg(),
            'pace': self._pace(ht, at),
            'norm_factor': self.norm_factor(),
        }


def paired_days(games: pd.DataFrame):
    """[(date, [(home_row, away_row), ...]), ...] in date order (rows are namedtuples)."""
    if games.empty:
        return []
    homes = games[games['home_away'] == 'Home']
    away_map = {r.game_id: r for r in games[games['home_away'] == 'Away'].itertuples(index=False)}
    days = {}
    for h in homes.itertuples(index=False):
        a = away_map.get(h.game_id)
        if a is None:
            continue
        days.setdefault(h.game_date, []).append((h, a))
    return sorted(days.items(), key=lambda kv: kv[0])


def build_state(games: pd.DataFrame, before_date=None) -> FeatureState:
    """Replay completed games (strictly before ``before_date`` if given)."""
    st = FeatureState()
    g = games
    if before_date is not None:
        g = g[g['game_date'] < pd.Timestamp(before_date).normalize()]
    for _, pairs in paired_days(g):
        st.update_pairs(pairs)
    return st


def build_training_matrix(games: pd.DataFrame) -> pd.DataFrame:
    """One row per completed game with pregame features (state BEFORE the date)."""
    st = FeatureState()
    rows = []
    for date, pairs in paired_days(games):
        for h, a in pairs:
            f = st.pregame(h.team, h.opponent, date, h.starting_goalie, a.starting_goalie,
                           season=int(h.season))
            f.update({
                'game_id': h.game_id, 'game_date': date, 'season': int(h.season),
                'game_type': game_type_of(h.game_id),
                'home': h.team, 'away': h.opponent,
                'h_goalie': h.starting_goalie, 'a_goalie': a.starting_goalie,
                'home_win': 1 if h.result in WIN_RESULTS else 0,
                'home_goals': h.goals_for, 'away_goals': h.goals_ag,
                'decision': ('SO' if h.result in ('SOW', 'SOL') else
                             'OT' if h.result in ('OTW', 'OTL') else 'REG'),
                'team_game_number_h': f['h_gp'] + 1, 'team_game_number_a': f['a_gp'] + 1,
            })
            rows.append(f)
        st.update_pairs(pairs)
    return pd.DataFrame(rows)


def build_pregame_features(games: pd.DataFrame, home, away, game_date, h_goalie=None, a_goalie=None,
                           h_rest_days=None, a_rest_days=None, state: FeatureState | None = None) -> dict:
    """Serving entry point: features for one upcoming game from completed history."""
    st = state if state is not None else build_state(games, before_date=game_date)
    return st.pregame(home, away, game_date, h_goalie, a_goalie, h_rest_days, a_rest_days)
