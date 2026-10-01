"""Raw lake -> per-season parquet tables (DESIGN §2.3).

Tables (``parquet/{table}/season={season}/part-0.parquet``, zstd):

  games     one row per game (teams, finals, outcome type, coverage + QA counts)
  events    every play with on-ice skaters/goalies, strength, normalised coordinates
  shots     shot attempts (505-508, no shootout) with geometry and on-ice lists
  shifts    de-duplicated shift charts (typeCode 517)
  lineups   dressed players + scratches per game (starter flag, TOI, shift TOI)
  players   season crosswalk: NHL id, names, name keys, teams, numbers, bio

A season partition is rebuilt from every raw game present (idempotent).
"""
from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor

import pandas as pd

from .crosswalk import build_players, roster_rows
from .fetch import read_raw
from .paths import Lake

TABLES = ("games", "events", "shots", "shifts", "lineups", "players")
FINAL_STATE_IDS = {6, 7}

BOOL_COLS = {"event_team_is_home", "acting_is_home", "empty_net_against", "own_goalie_pulled",
             "onice_primary_match", "is_home", "starter", "is_goalie", "is_shootout", "is_penalty_shot",
             "is_goal", "is_unblocked", "has_shifts", "has_boxscore", "has_rightrail", "on_season_roster"}
FLOAT_COLS = {"x", "y", "x_norm", "y_norm", "x_home", "y_home", "shot_distance", "shot_angle"}
NULLABLE_INT_COLS = {"sweater_number", "toi_s", "home_score", "away_score", "n_periods", "game_type",
                     "home_team_id", "away_team_id", "team_id", "event_team_id", "shooting_team_id",
                     "pen_type_code", "pen_duration", "height_in", "weight_lb", "shift_number"}
STR_COLS = {"season", "situation_code", "zone_code", "shot_type", "reason", "secondary_reason",
            "pen_desc_key", "type_desc", "period_type", "home_def_side_raw", "home_def_side",
            "home_def_side_vote", "side_source", "strength", "onice_rule", "position", "status", "source",
            "first_name", "last_name", "team_abbrev", "home_abbrev", "away_abbrev", "venue", "game_date",
            "start_time_utc", "last_period_type", "full_name", "name_key", "name_key_alias", "shoots",
            "birth_date", "birth_country"}


# --------------------------------------------------------------------- schedule

def schedule_games(lake: Lake, season: str, game_types=(2, 3), final_only: bool = True) -> pd.DataFrame:
    """Games of ``season`` from the cached stats-REST game list."""
    path = lake.raw_path("schedule", season, season)
    if not os.path.exists(path):
        return pd.DataFrame(columns=["game_id", "game_type", "game_state_id", "game_date",
                                     "home_team_id", "away_team_id"])
    d = read_raw(path)
    df = pd.DataFrame([{
        "game_id": int(g["id"]), "game_type": int(g.get("gameType", 0)),
        "game_state_id": g.get("gameStateId"), "game_date": g.get("gameDate"),
        "home_team_id": g.get("homeTeamId"), "away_team_id": g.get("visitingTeamId"),
    } for g in d.get("data") or [] if str(g.get("season")) == str(season)])
    if df.empty:
        return df
    df = df[df["game_type"].isin(list(game_types))]
    if final_only:
        df = df[df["game_state_id"].isin(FINAL_STATE_IDS)]
    return df.sort_values("game_id").reset_index(drop=True)


def sample_games(game_ids, n: int) -> list[int]:
    """``n`` games spread evenly over the season (deterministic)."""
    ids = sorted(int(g) for g in game_ids)
    if n <= 0 or n >= len(ids):
        return ids
    step = len(ids) / n
    return sorted({ids[int(i * step + step / 2)] for i in range(n)})


# ---------------------------------------------------------------------- parse

def _load(lake: Lake, endpoint: str, season: str, key):
    p = lake.raw_path(endpoint, season, key)
    return read_raw(p) if os.path.exists(p) else None


def parse_one(args) -> dict | None:
    root, season, gid = args
    from .parse import parse_game
    lake = Lake(root)
    pbp = _load(lake, "pbp", season, gid)
    if pbp is None:
        return None
    try:
        return parse_game(pbp, _load(lake, "shifts", season, gid), _load(lake, "boxscore", season, gid),
                          _load(lake, "rightrail", season, gid), season=season)
    except Exception as e:  # keep the season build going; the DQ gate reports the gap
        return {"error": f"{gid}: {e!r}"[:300]}


def season_rosters(lake: Lake, season: str) -> pd.DataFrame:
    d = os.path.join(lake.raw_dir, "roster", season)
    rows = []
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json.gz"):
                rows.extend(roster_rows(read_raw(os.path.join(d, fn)), season, fn.split(".")[0]))
    return pd.DataFrame(rows)


def _coerce(df: pd.DataFrame) -> pd.DataFrame:
    for c in df.columns:
        if c in BOOL_COLS:
            df[c] = df[c].map(lambda v: None if v is None or (isinstance(v, float) and v != v) else bool(v)
                              ).astype("boolean")
        elif c in FLOAT_COLS:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
        elif c in NULLABLE_INT_COLS:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
        elif c in STR_COLS:
            df[c] = df[c].map(lambda v: None if v is None or (isinstance(v, float) and v != v) else str(v))
    return df


def write_table(df: pd.DataFrame, path: str) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq
    os.makedirs(os.path.dirname(path), exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    tmp = path + ".tmp"
    pq.write_table(table, tmp, compression="zstd")
    os.replace(tmp, path)


def build_season(lake: Lake, season: str, game_ids=None, *, jobs: int = 1, log=print) -> dict:
    """Parse every raw game of ``season`` (or ``game_ids``) and write its partitions."""
    from .parse import shots_table
    if game_ids is None:
        d = os.path.join(lake.raw_dir, "pbp", season)
        game_ids = sorted(int(f.split(".")[0]) for f in os.listdir(d) if f.endswith(".json.gz")) \
            if os.path.isdir(d) else []
    args = [(lake.root, season, int(g)) for g in game_ids]
    if jobs > 1 and len(args) > 20:
        with ProcessPoolExecutor(max_workers=jobs) as ex:
            results = list(ex.map(parse_one, args, chunksize=8))
    else:
        results = [parse_one(a) for a in args]
    parts: dict[str, list] = {t: [] for t in ("games", "events", "shifts", "lineups")}
    errors = []
    for r in results:
        if r is None:
            continue
        if "error" in r:
            errors.append(r["error"])
            continue
        for t in parts:
            if r.get(t) is not None and len(r[t]):
                parts[t].append(r[t])
    tables = {t: (pd.concat(v, ignore_index=True) if v else pd.DataFrame()) for t, v in parts.items()}
    tables["shots"] = shots_table(tables["events"]) if len(tables["events"]) else pd.DataFrame()
    tables["players"] = build_players(tables["lineups"], season_rosters(lake, season), season)
    written = {}
    for t in TABLES:
        df = tables[t]
        if df is None or df.empty:
            continue
        write_table(_coerce(df.copy()), lake.table_path(t, season))
        written[t] = len(df)
    if errors:
        log(f"  [build {season}] {len(errors)} games failed to parse, e.g. {errors[0]}")
    log(f"  [build {season}] " + ", ".join(f"{t}={n:,}" for t, n in written.items()))
    return {"season": season, "rows": written, "errors": errors, "n_games": written.get("games", 0)}


def read_table(lake: Lake, table: str, seasons=None, columns=None) -> pd.DataFrame:
    import pyarrow.parquet as pq
    base = lake.table_dir(table)
    if not os.path.isdir(base):
        return pd.DataFrame()
    frames = []
    for d in sorted(os.listdir(base)):
        if not d.startswith("season="):
            continue
        s = d.split("=", 1)[1]
        if seasons is not None and s not in {str(x) for x in seasons}:
            continue
        p = os.path.join(base, d, "part-0.parquet")
        if os.path.exists(p):
            frames.append(pq.read_table(p, columns=columns).to_pandas())
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
