"""
goalie_shots.py — shot maps: every unblocked shot each goalie faced and each
skater took, for the player pages (public/data/goalie_shots, public/data/skater_shots).

Reads the scored shots file (location, xG, type, rebound, strength). The goalie
in net is the shot's goalie_id (recorded by scrape_games.py since 2026-10-08);
older rows take it from the per-game goalie logs (public/data/pony): the only
goalie a team used that game, or, when two played, the starter until his time
on ice ran out and the reliever after. Regular season only; empty-net shots
are left out.

    public/data/goalie_shots/<seasonId>/<goalieId>.json
        { "id", "cols": [...], "games": [gameId, ...], "meta": [[date, opponent, home, gf, ga, outcome], ...],
          "names": {playerId: ["F. Last", headshot, team]},
          "shots": [[gameIdx, x, y, xG, goal, onGoal, type, rebound, strength, period, clock, other,
                     score, since, last], ...] }
    public/data/goalie_shots/<seasonId>/league.json
        { "bins": [{"lo", "hi", "sog", "goals", "svPct"}...], "types": {...}, ... }

x, y are turned so the net is at x = +89 (_normalise). period and clock (seconds into the
period) place the shot in its game; other is the shooter on a goalie's file and the goalie
in net on a skater's (null when unknown), named in "names". meta[i] is games[i]'s date,
the opponent's tricode, 1 when the player's team was at home, that team's goals for and against
and how it ended (REG / OT / SO). score is the shooting team's lead before the shot; since is the
seconds since the event before it, last that event's index in LAST. strength is the goalie's side:
0 even, 1 shorthanded (his team killing a penalty), 2 his team on the power
play. Run after the xG rescore (refresh_pipeline full mode) and once with
--prev to write the previous season.
"""
from __future__ import annotations

import os
import re
import sys

import pandas as pd

from io_utils import atomic_write_json, keep_if_unchanged, read_json
from paths import pipeline_path, public_path
from season import PREV_START_YEAR, START_YEAR, season_file

COLS = ["game", "x", "y", "xg", "goal", "on_goal", "type", "rebound", "strength", "period", "clock", "other", "score", "since", "last"]
# The event before a shot (shots file last_event_type), by index.
LAST = ["faceoff", "hit", "shot-on-goal", "giveaway", "blocked-shot", "missed-shot", "takeaway", "delayed-penalty", "stoppage", "penalty", "goal"]
TYPES = ["wrist", "snap", "slap", "backhand", "tip-in", "deflected", "wrap-around", "other"]
# Danger by the shot's xG; HIGH matches the game page's high-danger chance (xG >= 0.20).
BINS = [(0.0, 0.06), (0.06, 0.20), (0.20, 1.01)]


def out_dir(start_year: int) -> str:
    return public_path("goalie_shots", f"{start_year}{start_year + 1}")


def _strength(state: str) -> int:
    """Shooter's strength state (e.g. '5v4') -> the goalie's side."""
    m = re.match(r"(\d)v(\d)", str(state))
    if not m:
        return 0
    us, them = int(m.group(1)), int(m.group(2))
    if us == them or us == 6:
        return 0
    return 1 if us > them else 2


def _normalise(df: pd.DataFrame) -> pd.DataFrame:
    """Turn every shot toward the net at x = +89 (the feed's x, y follow the rink, not the
    attacking direction): flip when the recorded distance fits the net at x = -89."""
    near = ((89 - df["x"]) ** 2 + df["y"] ** 2) ** 0.5
    far = ((-89 - df["x"]) ** 2 + df["y"] ** 2) ** 0.5
    flip = (far - df["distance"]).abs() < (near - df["distance"]).abs()
    df.loc[flip, ["x", "y"]] = -df.loc[flip, ["x", "y"]]
    return df


def _team_ids() -> dict[int, str]:
    t = pd.read_csv(public_path("nhl_teams.csv"))
    return {int(i): str(tri) for i, tri in zip(t["NHL Team ID"], t["Team Tricode"])}


def _goalie_lookup(start_year: int):
    """(game, defending tri, game second) -> goalie id, from the per-game goalie logs."""
    pony = read_json(public_path("pony", f"{start_year}{start_year + 1}.json"))
    if not pony:
        return None
    players = pony.get("players", {})
    names = {f"{v[0]} {v[1]}": int(k) for k, v in players.items() if len(v) > 2 and v[2] == "G"}
    by_team: dict[tuple[int, str], list[tuple[int, int]]] = {}
    for row in pony.get("goalies", []):
        by_team.setdefault((int(row[0]), str(row[2])), []).append((int(row[1]), int(row[5])))
    gs_path = pipeline_path(season_file("gamestats", start_year))
    starters: dict[tuple[int, str], str] = {}
    if os.path.exists(gs_path):
        gs = pd.read_csv(gs_path, usecols=["game_id", "team", "starting_goalie"])
        common = pd.read_csv(public_path("nhl_teams.csv"))
        tri_of = dict(zip(common["Common Name"], common["Team Tricode"]))
        tri_of.update({"Utah Hockey Club": "UTA", "Mammoth": "UTA"})
        for gid, team, name in gs.itertuples(index=False):
            if isinstance(name, str) and team in tri_of:
                starters[(int(gid), tri_of[team])] = name

    def find(gid: int, tri: str, sec: int):
        rows = by_team.get((gid, tri))
        if not rows:
            return None
        if len(rows) == 1:
            return rows[0][0]
        first = names.get(starters.get((gid, tri), ""))
        start = next((r for r in rows if r[0] == first), max(rows, key=lambda r: r[1]))
        relief = [r for r in rows if r[0] != start[0]]
        return start[0] if sec < start[1] or not relief else relief[0][0]

    return find


def _person(players: dict, pid) -> list | None:
    """[short name, headshot, team] for a player id."""
    p = players.get(str(int(pid))) if pid is not None and pd.notna(pid) else None
    return [f"{p[0][:1]}. {p[1]}", p[4] if len(p) > 4 else None, p[5] if len(p) > 5 else None] if p else None


def _file(pid: int, part: pd.DataFrame, own_team: dict, games: dict, players: dict, other_col: str) -> dict:
    """One player's shot file: rows by game index, each game's date / opponent / home, and the names of the
    other players the rows point at."""
    gl = sorted(int(g) for g in part["game_id"].unique())
    gi = {g: i for i, g in enumerate(gl)}
    meta = []
    for g in gl:
        info = games.get(str(g))
        tri = own_team.get(g)
        if info and tri:
            home = info[2] == tri
            gf, ga = (info[4], info[3]) if home else (info[3], info[4])
            meta.append([info[0], info[1] if home else info[2], int(home), int(gf), int(ga), info[5] if len(info) > 5 else None])
        else:
            meta.append([None, None, None, None, None, None])
    rows, names = [], {}
    for r in part.itertuples(index=False):
        other = getattr(r, other_col)
        other = int(other) if other is not None and pd.notna(other) else None
        if other is not None and str(other) not in names:
            n = _person(players, other)
            if n:
                names[str(other)] = n
        last = str(r.last_event_type) if pd.notna(r.last_event_type) else ""
        rows.append([
            gi[int(r.game_id)], int(r.x), int(r.y), round(float(r.xG), 3), int(r.goal), int(r.on_goal), int(r.type),
            int(r.is_rebound or 0), int(r.strength), int(r.period), int(r.time_seconds), other,
            int(r.score_differential) if pd.notna(r.score_differential) else None,
            int(r.time_since_last_event) if pd.notna(r.time_since_last_event) else None,
            LAST.index(last) if last in LAST else None,
        ])
    return {"id": int(pid), "cols": COLS, "games": gl, "meta": meta, "names": names, "shots": rows}


def build(start_year: int) -> tuple[dict, dict, dict] | None:
    path = pipeline_path(season_file("shots", start_year))
    if not os.path.exists(path):
        return None
    shots = pd.read_csv(path, low_memory=False)
    shots = _normalise(shots.dropna(subset=["xG", "x", "y"]))
    shots = shots[shots["strength_state"] != "EmptyNet"]
    # Regular season only (game type 02), matching the goalie game logs and pages.
    shots = shots[shots["game_id"].astype(str).str[4:6] == "02"]
    if shots.empty:
        return None
    if "goalie_id" not in shots.columns:
        shots["goalie_id"] = pd.NA
    teams = _team_ids()
    pony = read_json(public_path("pony", f"{start_year}{start_year + 1}.json")) or {}
    games = pony.get("games", {})
    find = _goalie_lookup(start_year)

    def goalie(r) -> int | None:
        if pd.notna(r.goalie_id):
            return int(r.goalie_id)
        g = games.get(str(int(r.game_id)))
        shooter = teams.get(int(r.team_id))
        if not g or not shooter or not find:
            return None
        defending = g[2] if g[1] == shooter else g[1]
        # time_seconds is the clock within its period; the goalie logs count game seconds.
        return find(int(r.game_id), defending, (int(r.period) - 1) * 1200 + int(r.time_seconds))

    shots["gid"] = [goalie(r) for r in shots.itertuples(index=False)]
    df = shots.dropna(subset=["gid"]).copy()
    df["gid"] = df["gid"].astype(int)
    df["goal"] = (df["is_goal"].fillna(0).astype(int) == 1).astype(int)
    df["on_goal"] = df["event_type"].isin([505, 506]).astype(int)
    df["type"] = df["shot_type"].fillna("other").map(lambda t: TYPES.index(t) if t in TYPES else TYPES.index("other"))
    df["strength"] = df["strength_state"].map(_strength)
    # The shots file's is_rebound is never set; a rebound is a shot within 3 s of a shot on goal.
    df["is_rebound"] = ((df["last_event_type"] == "shot-on-goal") & (df["time_since_last_event"] <= 3)).astype(int)

    players = pony.get("players", {})
    out: dict[int, dict] = {}
    for gid, part in df.groupby("gid"):
        # The goalie's team is the side the shooter was not on.
        own = {}
        for g, tid in zip(part["game_id"], part["team_id"]):
            info = games.get(str(int(g)))
            shooter = teams.get(int(tid))
            if info and shooter:
                own[int(g)] = info[2] if info[1] == shooter else info[1]
        out[int(gid)] = _file(int(gid), part, own, games, players, "player_id")

    sog = df[df["on_goal"] == 1]
    bins = []
    for lo, hi in BINS:
        b = sog[(sog["xG"] >= lo) & (sog["xG"] < hi)]
        n, g = int(len(b)), int(b["goal"].sum())
        bins.append({"lo": lo, "hi": min(hi, 1.0), "sog": n, "goals": g, "svPct": round(1 - g / n, 4) if n else None})
    types = {}
    for i, t in enumerate(TYPES):
        b = sog[sog["type"] == i]
        if len(b):
            types[t] = {"sog": int(len(b)), "svPct": round(float(1 - b["goal"].sum() / len(b)), 4)}
    reb = sog[sog["is_rebound"] == 1]
    if len(reb):
        types["rebound"] = {"sog": int(len(reb)), "svPct": round(float(1 - reb["goal"].sum() / len(reb)), 4)}
    league = {
        "bins": bins,
        "types": types,
        "typeNames": TYPES,
        "svPct": round(float(1 - sog["goal"].sum() / len(sog)), 4) if len(sog) else None,
        "goalies": len(out),
        "shots": int(len(df)),
        "unmatched": int(len(shots) - len(df)),
    }
    # (game, event) -> goalie in net, so the skater files can name him on older rows too.
    goalie_of = {(int(g), int(e)): int(k) for g, e, k in zip(df["game_id"], df["event_id"], df["gid"])}
    return out, league, goalie_of


def build_skaters(start_year: int, goalie_of: dict | None = None) -> dict[int, dict] | None:
    """Every unblocked shot each skater took (regular season, empty nets included).

    strength here is the shooter's side: 0 even, 1 his team on the power play,
    2 shorthanded, 3 into an empty net."""
    path = pipeline_path(season_file("shots", start_year))
    if not os.path.exists(path):
        return None
    df = _normalise(pd.read_csv(path, low_memory=False).dropna(subset=["xG", "x", "y", "player_id"]))
    df = df[df["game_id"].astype(str).str[4:6] == "02"]
    if df.empty:
        return None
    df["goal"] = (df["is_goal"].fillna(0).astype(int) == 1).astype(int)
    df["on_goal"] = df["event_type"].isin([505, 506]).astype(int)
    df["type"] = df["shot_type"].fillna("other").map(lambda t: TYPES.index(t) if t in TYPES else TYPES.index("other"))
    df["is_rebound"] = ((df["last_event_type"] == "shot-on-goal") & (df["time_since_last_event"] <= 3)).astype(int)
    goalie_side = df["strength_state"].map(_strength)
    df["strength"] = goalie_side.map({0: 0, 1: 1, 2: 2})
    df.loc[df["strength_state"] == "EmptyNet", "strength"] = 3
    # The goalie in net: the recorded one, else from the goalie shot files' matching (same rows, keyed by event).
    if "goalie_id" not in df.columns:
        df["goalie_id"] = pd.NA
    if goalie_of:
        df["goalie_id"] = [
            r.goalie_id if pd.notna(r.goalie_id) else goalie_of.get((int(r.game_id), int(r.event_id)))
            for r in df.itertuples(index=False)
        ]
    teams = _team_ids()
    pony = read_json(public_path("pony", f"{start_year}{start_year + 1}.json")) or {}
    games, players = pony.get("games", {}), pony.get("players", {})
    out: dict[int, dict] = {}
    for pid, part in df.groupby("player_id"):
        own = {int(g): teams.get(int(t)) for g, t in zip(part["game_id"], part["team_id"])}
        out[int(pid)] = _file(int(pid), part, own, games, players, "goalie_id")
    return out


def main(argv=None):
    argv = argv or []
    years = [PREV_START_YEAR] if "--prev" in argv else [START_YEAR]
    written = 0
    for y in years:
        built = build(y)
        if not built:
            print(f"  goalie shots {y}: no shots yet")
            continue
        goalies, league, goalie_of = built
        d = out_dir(y)
        os.makedirs(d, exist_ok=True)
        for gid, data in goalies.items():
            path = os.path.join(d, f"{gid}.json")
            data = keep_if_unchanged(read_json(path), data, keys=set())
            if atomic_write_json(path, data, indent=None, separators=(",", ":"), label=f"goalie_shots_{y}_{gid}"):
                written += 1
        atomic_write_json(os.path.join(d, "league.json"), league, indent=None, separators=(",", ":"), label=f"goalie_shots_{y}_league")
        print(f"  goalie shots {y}-{(y + 1) % 100:02d}: {len(goalies)} goalies, {league['shots']} shots ({league['unmatched']} unmatched)")
        skaters = build_skaters(y, goalie_of) or {}
        sd = public_path("skater_shots", f"{y}{y + 1}")
        os.makedirs(sd, exist_ok=True)
        for pid, data in skaters.items():
            path = os.path.join(sd, f"{pid}.json")
            data = keep_if_unchanged(read_json(path), data, keys=set())
            if atomic_write_json(path, data, indent=None, separators=(",", ":"), label=f"skater_shots_{y}_{pid}"):
                written += 1
        print(f"  skater shots {y}-{(y + 1) % 100:02d}: {len(skaters)} skaters")
    return {"status": "ok" if written else "skip", "rows_written": written}


if __name__ == "__main__":
    main(sys.argv[1:])
