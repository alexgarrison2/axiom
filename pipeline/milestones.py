#!/usr/bin/env python3
"""
milestones.py - players coming up on milestones, for /players/milestones.

Every active NHL player (on a current roster) is checked against:

    career     round-number career totals (games, goals, assists, points, PP
               goals and points, game-winners, shots, hits, blocks, faceoff
               wins; goalie games, wins, shutouts, saves), with the number of
               players in NHL history who have reached each one
    alltime    the next name he passes on the NHL's all-time list (top 100 for
               games, goals, assists, points and wins, top 50 for the rest),
               Hall of Famers flagged, plus the highest Hall of Famer he
               reaches this season at his pace
    franchise  the next name he passes in his current franchise's top 10
               (the franchise record when that name is first)
    streak     an active point streak (5+) or goal streak (3+), with the
               season's longest; the iron-man streak (consecutive regular-
               season games played) at every 100 and past the longest active one
    season     on pace for 50 goals, 100 points, 70 assists or 40 wins, and
               the race to be the league's first to a round number this season
    pony       pony xG ixG since the first season of the shot archive

Each one carries how far away he is, his pace per game (the last two
seasons pooled, else his career), the projected game (the team's Nth
remaining game, starting after an ESPN return date for injured players;
goalies by their share of starts) and the team's next game. Only
milestones he reaches this season at his pace are kept. Milestones crossed
in the last 10 days are listed under ``recent``.

Sources: NHL stats API (career, franchise and season aggregates, one query
each, regular season only), records.nhl.com (franchises, Hall of Fame), the
current rosters (fetch_player_bio), the season schedule
(data/schedule_detail_<season>.json, fetch_schedule_detail.py), per-game
skater logs (nhl_season_*_skater_games.csv), the shot archive for ixG,
ESPN injuries (public/data/injuries.json) and, for the iron-man streak, each
player's game logs and his clubs' schedules in earlier seasons
(api-web.nhle.com). That walk ends at last season's final game and is cached
in milestones_ironman.json (rebuilt when the season rolls over), so a daily
run only extends it with this season's skater logs.

Output: public/data/milestones.json
    { season, built_at, since_ixg, players: {id: [first, last, pos, team, out]},
      next: {TRI: [gameId, date, startUTC, opp, home]},
      items: [...], recent: [...] }

Run from pipeline/:  python3 milestones.py
"""
from __future__ import annotations

import math
import os
import time
from datetime import date, timedelta
from urllib.parse import quote

import pandas as pd

from fetch_player_bio import fetch_rosters
from http_utils import get_json
from io_utils import atomic_write_json, keep_if_unchanged, read_json, utc_now_iso, VOLATILE_KEYS
from paths import PIPELINE_DIR, PUBLIC_DATA_DIR
from season import PREV_SEASON_ID, PREV_START_YEAR, SEASON_ID, START_YEAR, season_file, season_games, today_local

STATS = "https://api.nhle.com/stats/rest/en"
RECORDS = "https://records.nhl.com/site/api"
OUT = os.path.join(PUBLIC_DATA_DIR, "milestones.json")
WEB = "https://api-web.nhle.com/v1"
IRONMAN_CACHE = os.path.join(PIPELINE_DIR, "milestones_ironman.json")
RECENT_DAYS = 10

# Stat key -> (report, field) in the NHL stats API.
SKATER_FIELDS = {
    "gp": ("summary", "gamesPlayed"), "g": ("summary", "goals"), "a": ("summary", "assists"),
    "p": ("summary", "points"), "ppg": ("summary", "ppGoals"), "ppp": ("summary", "ppPoints"),
    "gwg": ("summary", "gameWinningGoals"), "sog": ("summary", "shots"),
    "hit": ("realtime", "hits"), "blk": ("realtime", "blockedShots"), "fow": ("faceoffwins", "totalFaceoffWins"),
}
GOALIE_FIELDS = {"gp": "gamesPlayed", "w": "wins", "so": "shutouts", "sv": "saves"}


def _r(lo, step, hi, extra=()):
    return sorted(set(range(lo, hi + 1, step)) | set(extra))


# Round numbers worth a headline, per stat.
LADDERS = {
    "gp": _r(1000, 100, 2000, (100, 250, 500, 750)),
    "g": _r(100, 50, 1000),
    "a": _r(100, 100, 2000, (250, 750, 1250)),
    "p": _r(100, 100, 3000, (250, 750, 1250)),
    "ppg": _r(50, 50, 400),
    "ppp": _r(100, 100, 1000, (250,)),
    "gwg": _r(25, 25, 150),
    "sog": _r(1000, 500, 8000),
    "hit": _r(1000, 500, 5000),
    "blk": _r(500, 500, 3000),
    "fow": _r(1000, 1000, 20000),
    "w": _r(100, 50, 700),
    "so": _r(10, 10, 130, (25, 75)),
    "sv": _r(5000, 5000, 35000),
    "ixg": _r(50, 50, 500),
}
SKATER_CAREER = ("gp", "g", "a", "p", "ppg", "ppp", "gwg", "sog", "hit", "blk", "fow")
GOALIE_CAREER = ("gp", "w", "so", "sv")
# All-time list depth that is worth a pass, per stat.
ALLTIME_TOP = {"gp": 100, "g": 100, "a": 100, "p": 100, "w": 100, "ppg": 50, "ppp": 50, "gwg": 50, "so": 50, "sv": 50}
SKATER_ALLTIME = ("gp", "g", "a", "p", "ppg", "ppp", "gwg")
GOALIE_ALLTIME = ("gp", "w", "so", "sv")
FRANCHISE_TOP = 10
SKATER_FRANCHISE = ("gp", "g", "a", "p", "ppg", "gwg")
GOALIE_FRANCHISE = ("gp", "w", "so")
# The most a player plausibly adds in one game: within this, it can happen tonight.
ONE_GAME = {"gp": 1, "g": 2, "a": 2, "p": 3, "ppg": 1, "ppp": 2, "gwg": 1, "sog": 5, "hit": 4, "blk": 3,
            "fow": 10, "w": 1, "so": 1, "sv": 30, "ixg": 0.6, "pstreak": 1, "gstreak": 1, "ironman": 1}
PACE = {"g": 50, "p": 100, "w": 40}
RACE = {"g": (10, 20, 30, 40, 50, 60), "p": (25, 50, 75, 100, 125), "w": (10, 20, 30, 40)}
RACE_WITHIN = {"g": 3, "p": 4, "w": 2}
STREAK_LADDER = (5, 10, 15, 20, 25, 30)
IRONMAN_LADDER = tuple(range(100, 1001, 100))
IRONMAN_RARE = 500   # straight-game targets from here show all season, like rare career numbers
END = "9999-12-31"   # the present, as the last entry of an iron-man walk
MIN_BASIS = 10   # games behind a pace before it is not marked thin
# Common round numbers (more than RARE_CLUB players have them) only show inside
# the next NEAR_GAMES team games; rare ones, list passes, streaks and the season
# races show all season.
RARE_CLUB = 100
NEAR_GAMES = 30


# ── Fetching ────────────────────────────────────────────────────────────────

def _stats(kind: str, report: str, exp: str, game: bool = False) -> list[dict]:
    url = (f"{STATS}/{kind}/{report}?isAggregate={'false' if game else 'true'}&isGame={'true' if game else 'false'}"
           f"&limit=-1&cayenneExp={quote(exp)}")
    rows = (get_json(url, ua="plain") or {}).get("data") or []
    if len(rows) >= 10000:
        raise RuntimeError(f"{kind}/{report} hit the 10k row cap ({exp})")
    return rows


def _by_id(rows, field):
    return {int(r["playerId"]): (r.get(field) or 0) for r in rows if r.get("playerId")}


def skater_totals(exp: str) -> dict[str, dict[int, float]]:
    reports = {rep: _stats("skater", rep, exp) for rep in {r for r, _ in SKATER_FIELDS.values()}}
    return {k: _by_id(reports[rep], f) for k, (rep, f) in SKATER_FIELDS.items()}


def goalie_totals(exp: str) -> dict[str, dict[int, float]]:
    rows = _stats("goalie", "summary", exp)
    return {k: _by_id(rows, f) for k, f in GOALIE_FIELDS.items()}


def all_time_names() -> dict[int, str]:
    names = {}
    for kind, field in (("skater", "skaterFullName"), ("goalie", "goalieFullName")):
        for r in _stats(kind, "summary", "gameTypeId=2"):
            names[int(r["playerId"])] = r.get(field) or ""
    return names


def hall_of_fame() -> set[int]:
    url = f"{RECORDS}/player?cayenneExp={quote('inHockeyHof=true')}&include=id&limit=-1"
    return {int(r["id"]) for r in (get_json(url, ua="plain") or {}).get("data") or [] if r.get("id")}


def franchises() -> dict[str, int]:
    rows = (get_json(f"{RECORDS}/franchise?limit=100", ua="plain") or {}).get("data") or []
    return {r["teamAbbrev"]: int(r["id"]) for r in rows if r.get("lastSeasonId") is None and r.get("teamAbbrev")}


# ── Local inputs ────────────────────────────────────────────────────────────

def team_schedules(season_id: str = SEASON_ID) -> dict[str, list[dict]]:
    doc = read_json(os.path.join(PIPELINE_DIR, "data", f"schedule_detail_{season_id}.json"), {}) or {}
    out: dict[str, list[dict]] = {}
    for g in doc.get("games") or []:
        if g.get("type") != 2:
            continue
        for side, opp, home in (("home", "away", 1), ("away", "home", 0)):
            out.setdefault(g[side], []).append({"id": g["id"], "date": g["date"], "start": g.get("start"),
                                                "opp": g[opp], "home": home,
                                                "done": g.get("state") in ("OFF", "FINAL")})
    for games in out.values():
        games.sort(key=lambda x: (x["start"] or x["date"], x["id"]))
    return out


def skater_games() -> pd.DataFrame:
    path = os.path.join(PIPELINE_DIR, season_file("skater_games"))
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_csv(path)
    df = df[df["game_id"].astype(str).str[4:6] == "02"]
    return df.sort_values(["player_id", "date", "game_id"])


def ixg_since() -> tuple[int | None, dict[int, float], dict[int, float]]:
    """(first season start year, ixG since then, ixG over this season and last) per shooter, regular season."""
    total: dict[int, float] = {}
    cur: dict[int, float] = {}
    recent: dict[int, float] = {}
    first = None
    hist = os.path.join(PIPELINE_DIR, "nhl_historical_shots.csv")
    if os.path.exists(hist):
        h = pd.read_csv(hist, usecols=["game_id", "player_id", "xG"])
        h = h[(h["game_id"] // 1_000_000 < START_YEAR) & (h["game_id"] // 10_000 % 100 == 2)]
        if not h.empty:
            first = int(h["game_id"].min() // 1_000_000)
            total = h.groupby("player_id")["xG"].sum().to_dict()
            recent = h[h["game_id"] // 1_000_000 == PREV_START_YEAR].groupby("player_id")["xG"].sum().to_dict()
    path = os.path.join(PIPELINE_DIR, season_file("shots"))
    if os.path.exists(path):
        c = pd.read_csv(path, usecols=["game_id", "player_id", "xG"])
        c = c[c["game_id"] // 10_000 % 100 == 2]
        cur = c.groupby("player_id")["xG"].sum().to_dict()
        for k, v in cur.items():
            total[k] = total.get(k, 0.0) + v
            recent[k] = recent.get(k, 0.0) + v
        if first is None and not c.empty:
            first = START_YEAR
    return first, {int(k): float(v) for k, v in total.items()}, {int(k): float(v) for k, v in recent.items()}


def injuries() -> dict[int, dict]:
    out = {}
    for r in read_json(os.path.join(PUBLIC_DATA_DIR, "injuries.json"), []) or []:
        if r.get("playerId"):
            out[int(r["playerId"])] = r
    return out


def out_tag(inj: dict | None) -> str | None:
    s = ((inj or {}).get("status") or "").lower()
    if not s:
        return None
    if "reserve" in s or "ltir" in s:
        return "IR"
    if "day" in s:
        return "DTD"
    return "OUT"


# ── Core maths (pure) ───────────────────────────────────────────────────────

def next_rung(value: float, ladder) -> int | None:
    return next((m for m in ladder if m > value + 1e-9), None)


def games_needed(need: float, rate: float) -> int | None:
    """Player games to cover ``need`` at ``rate`` per game (None when the pace is zero)."""
    if need <= 0:
        return 0
    if rate <= 0:
        return None
    return max(1, math.ceil(need / rate - 1e-9))


def team_games_for(k: int, share: float) -> int:
    return max(1, math.ceil(k / max(share, 1e-6) - 1e-9))


def club_size(target: float, values) -> int:
    """Players who have reached ``target``."""
    return sum(1 for v in values if v >= target)


def top_groups(table: dict[int, float], top: int) -> list[tuple[int, float, list[int]]]:
    """The top ``top`` ranks of ``table`` as (rank, value, [ids at that value]), best first."""
    groups: list[tuple[int, float, list[int]]] = []
    seen = 0
    for i, v in sorted(table.items(), key=lambda x: -x[1]):
        if v <= 0:
            break
        if groups and groups[-1][1] == v:
            groups[-1][2].append(i)
        else:
            rank = seen + 1
            if rank > top:
                break
            groups.append((rank, v, [i]))
        seen += 1
    return groups


def passes(value: float, pid: int, groups) -> list[tuple[int, float, list[int]]]:
    """Groups above ``value`` that hold someone other than ``pid``, nearest first."""
    out = []
    for rank, v, ids in groups:
        others = [i for i in ids if i != pid]
        if v > value and others:
            out.append((rank, v, others))
    out.reverse()
    return out


def ladder(ups, k: int, names: dict[int, str], hof: set[int], players, gp: dict[int, float]) -> list[list]:
    """The list around a pass: up to two places above the name he passes, then
    that name, best first, as [rank, id, name, value, hall of famer, others tied,
    games played on that list (career, or with the franchise)]."""
    out = []
    for rank, val, ids in reversed(ups[k:k + 3]):
        ids = sorted(ids, key=lambda i: (i not in hof, i not in players, names.get(i, "")))
        out.append([rank, ids[0], names.get(ids[0], ""), int(val), int(ids[0] in hof), len(ids) - 1, int(gp.get(ids[0], 0))])
    return out


def rank_now(have: float, pid: int, table: dict[int, float]) -> int:
    return 1 + sum(1 for i, v in table.items() if i != pid and v > have)


def streak(flags) -> int:
    n = 0
    for f in reversed(list(flags)):
        if not f:
            break
        n += 1
    return n


def longest(flags) -> int:
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def missed(p: tuple, q: tuple, club_dates) -> bool:
    """Did he miss a club game between two of his games ``p`` and ``q``
    ((season id, date, club), in order)? Within a season the club is the one
    he plays ``q`` for, so after a trade only the new club's games count (the
    old club's games after his last one may come after the trade). Across
    seasons: the old club's games after ``p`` and the new club's before ``q``.
    ``club_dates(club, season id)`` lists the club's completed regular-season
    game dates."""
    if p[0] == q[0]:
        return any(p[1] < d < q[1] for d in club_dates(q[2], q[0]))
    return any(d > p[1] for d in club_dates(p[2], p[0])) or any(d < q[1] for d in club_dates(q[2], q[0]))


def straight_games(games: list[tuple], club_dates) -> int:
    """The iron-man streak: his games at the end of ``games`` (oldest first)
    with no missed club game between them. The last entry is the present
    ((season id, END, current club)), not a game, so a club game since his
    last one ends the streak at 0. Equal to len(games) - 1 when it runs back
    to the first game listed."""
    n = 0
    for p, q in zip(reversed(games[:-1]), reversed(games[1:])):
        if missed(p, q, club_dates):
            break
        n += 1
    return n


def assign_places(items: list[dict]) -> None:
    """Players chasing the same number (or the same name on a list) cannot all
    take the same place: the place each takes is ordered by projected game,
    and players projected for the same night share it (``tie``). Career and
    pony xG round numbers get ``nth`` (club + order); passes get a new ``rank``."""
    groups: dict[tuple, list[dict]] = {}
    for i in items:
        if i["kind"] in ("career", "pony"):
            key = (i["kind"], i["stat"], i["target"])
        elif i["kind"] in ("alltime", "franchise"):
            key = (i["kind"], i["stat"], i.get("fr"), i["rank"])
        else:
            continue
        groups.setdefault(key, []).append(i)
    for key, chasers in groups.items():
        chasers.sort(key=lambda i: (i["eta"][1], i["eta"][4], i["need"]))
        place, prev = 0, None
        for idx, i in enumerate(chasers):
            when = i["eta"][1]
            if when != prev:
                place, prev = idx, when
            tied = sum(1 for j in chasers if j["eta"][1] == when) > 1
            if key[0] in ("career", "pony"):
                i["nth"] = int(i.get("club", 0)) + place + 1
            else:
                i["rank"] = int(i["rank"]) + place
            if tied:
                i["tie"] = 1


# ── Iron man ────────────────────────────────────────────────────────────────

def _sid(start_year: int) -> str:
    return f"{start_year}{start_year + 1}"


def game_log(pid: int, start_year: int) -> list[tuple]:
    """His regular-season games in a season as (season id, date, club), oldest first."""
    sid = _sid(start_year)
    rows = (get_json(f"{WEB}/player/{pid}/game-log/{sid}/2", ua="plain") or {}).get("gameLog") or []
    return sorted((sid, r["gameDate"], r["teamAbbrev"]) for r in rows if r.get("gameDate") and r.get("teamAbbrev"))


class ClubDates:
    """Completed regular-season game dates per (club, season id), fetched once."""

    def __init__(self):
        self.seen: dict[tuple[str, str], list[str]] = {}

    def __call__(self, club: str, sid: str) -> list[str]:
        if (club, sid) not in self.seen:
            games = (get_json(f"{WEB}/club-schedule-season/{club}/{sid}", ua="plain") or {}).get("games") or []
            self.seen[(club, sid)] = sorted(g["gameDate"] for g in games
                                            if g.get("gameType") == 2 and g.get("gameState") in ("OFF", "FINAL"))
        return self.seen[(club, sid)]


def walk_tail(pid: int, log=game_log, club_dates=None, max_seasons: int = 25) -> list:
    """His streak at the end of last season, walking earlier seasons until he
    missed a game: [games, date of his last game, its club], [0] when he did
    not play last season or missed his club's last games."""
    club_dates = club_dates or ClubDates()
    games = log(pid, PREV_START_YEAR)
    if not games:
        return [0]
    last = games[-1]
    games = games + [(PREV_SEASON_ID, END, last[2])]
    year = PREV_START_YEAR
    while True:
        n = straight_games(games, club_dates)
        if n < len(games) - 1 or PREV_START_YEAR - year + 1 >= max_seasons:
            break
        year -= 1
        earlier = log(pid, year)
        if not earlier:
            break
        games = earlier + games
    return [n, last[1], last[2]] if n else [0]


def ironman_tails(pids) -> dict[int, list]:
    """walk_tail for each player, from the cache (keyed to this season) and
    walking only the players it does not have yet."""
    doc = read_json(IRONMAN_CACHE, {}) or {}
    tails = {int(k): v for k, v in (doc.get("tails") or {}).items()} if doc.get("season") == SEASON_ID else {}
    todo = [p for p in pids if p not in tails]
    if todo:
        t0, club_dates, failed = time.time(), ClubDates(), 0
        for pid in todo:
            try:
                tails[pid] = walk_tail(pid, club_dates=club_dates)
            except Exception as e:  # one player's log failing must not cost the board
                failed += 1
                print(f"  [WARN] iron-man walk {pid}: {e}")
        print(f"  iron man: walked {len(todo) - failed} players ({failed} failed), {time.time() - t0:.0f}s")
        atomic_write_json(IRONMAN_CACHE, {"season": SEASON_ID, "tails": {str(k): tails[k] for k in sorted(tails)}},
                          indent=None, separators=(",", ":"), label="milestones_ironman.json")
    return tails


def ironman_streaks(sg: pd.DataFrame, clubs: dict[int, str], tails: dict[int, list]) -> dict[int, int]:
    """Each player's active streak: this season's games from the skater logs,
    joined to last season's cached tail when he has missed nothing since.
    ``clubs`` is each player's current club. A club game counts as completed
    once it is in the skater logs, so a log a day behind breaks nothing."""
    logged = sg.drop_duplicates("game_id") if not sg.empty else sg
    done: dict[str, list[str]] = {}
    for _, r in logged.iterrows():
        for club in (r["team"], r["opp"]):
            done.setdefault(club, []).append(r["date"])
    cur_dates = lambda club, sid: done.get(club, []) if sid == SEASON_ID else []
    mine = {int(pid): list(zip(g["date"], g["team"])) for pid, g in sg.groupby("player_id")} if not sg.empty else {}
    out = {}
    for pid, club in clubs.items():
        tail = tails.get(pid) or [0]
        games = [(SEASON_ID, d, t) for d, t in mine.get(pid, [])] + [(SEASON_ID, END, club)]
        if tail[0]:
            games.insert(0, (PREV_SEASON_ID, tail[1], tail[2]))
        n = straight_games(games, cur_dates)
        if tail[0] and n == len(games) - 1:
            n += tail[0] - 1
        if n:
            out[pid] = n
    return out


# ── Build ───────────────────────────────────────────────────────────────────

class Ctx:
    def __init__(self):
        self.today = today_local()
        self.sched = team_schedules()
        self.inj = injuries()

    def remaining(self, tri: str, pid: int) -> list[dict]:
        games = [g for g in self.sched.get(tri, []) if not g["done"]]
        back = (self.inj.get(pid) or {}).get("returnDate")
        tag = out_tag(self.inj.get(pid))
        if back and tag in ("IR", "OUT"):
            games = [g for g in games if g["date"] >= back[:10]]
        return games

    def team_gp(self, tri: str) -> int:
        return sum(1 for g in self.sched.get(tri, []) if g["done"])


def eta(ctx: Ctx, tri: str, pid: int, team_games: int):
    """[gameId, date, opp, home, team game number] of his ``team_games``-th remaining game."""
    rem = ctx.remaining(tri, pid)
    if team_games < 1 or team_games > len(rem):
        return None
    g = rem[team_games - 1]
    return [g["id"], g["date"], g["opp"], g["home"], ctx.sched[tri].index(g) + 1]


def build() -> dict:
    t0 = time.time()
    ctx = Ctx()
    if len(ctx.sched) < 32:
        raise RuntimeError(f"schedule has {len(ctx.sched)} teams")
    rosters = fetch_rosters()
    if len(rosters) < 32:
        raise RuntimeError(f"rosters for {len(rosters)}/32 teams")

    players: dict[int, dict] = {}
    for tri, data in rosters.items():
        for group in ("forwards", "defensemen", "goalies"):
            for p in data.get(group) or []:
                pid = int(p["id"])
                players[pid] = {"first": (p.get("firstName") or {}).get("default", ""),
                                "last": (p.get("lastName") or {}).get("default", ""),
                                "pos": p.get("positionCode", ""), "team": tri, "goalie": group == "goalies"}

    alltime_exp = "gameTypeId=2"
    cur_exp = f"gameTypeId=2 and seasonId={SEASON_ID}"
    prev_exp = f"gameTypeId=2 and seasonId={PREV_SEASON_ID}"
    sk = {"car": skater_totals(alltime_exp), "cur": skater_totals(cur_exp), "prev": skater_totals(prev_exp)}
    gk = {"car": goalie_totals(alltime_exp), "cur": goalie_totals(cur_exp), "prev": goalie_totals(prev_exp)}
    names = all_time_names()
    hof = hall_of_fame()
    fr = franchises()
    fr_sk = {tri: skater_totals(f"gameTypeId=2 and franchiseId={fid}") for tri, fid in fr.items()}
    fr_gk = {tri: goalie_totals(f"gameTypeId=2 and franchiseId={fid}") for tri, fid in fr.items()}
    since, ixg_tot, ixg_two = ixg_since()
    print(f"  milestones inputs: {len(players)} rostered, {len(names)} all-time, {len(hof)} HOF, "
          f"{len(fr)} franchises, {time.time() - t0:.1f}s")

    prev_games = season_games(PREV_START_YEAR)
    at_groups = {("g" if gl else "s", k): top_groups((gk if gl else sk)["car"][k], ALLTIME_TOP[k])
                 for gl, keys in ((False, SKATER_ALLTIME), (True, GOALIE_ALLTIME)) for k in keys}
    fr_groups = {(tri, gl, k): top_groups(tab[tri][k], FRANCHISE_TOP)
                 for gl, tab, keys in ((False, fr_sk, SKATER_FRANCHISE), (True, fr_gk, GOALIE_FRANCHISE))
                 for tri in tab for k in keys}
    items: list[dict] = []

    def rate_for(pid: int, key: str, goalie: bool) -> tuple[float, int]:
        """(per-game pace, games behind it): last two seasons pooled, else career."""
        t = gk if goalie else sk
        gp = t["cur"]["gp"].get(pid, 0) + t["prev"]["gp"].get(pid, 0)
        val = t["cur"][key].get(pid, 0) + t["prev"][key].get(pid, 0)
        cgp = t["car"]["gp"].get(pid, 0)
        if gp < MIN_BASIS and cgp >= MIN_BASIS:
            return t["car"][key].get(pid, 0) / cgp, cgp
        return (val / gp if gp else 0.0), gp

    def start_share(pid: int, tri: str) -> float:
        gp = gk["cur"]["gp"].get(pid, 0) + gk["prev"]["gp"].get(pid, 0)
        team = ctx.team_gp(tri) + (prev_games if gk["prev"]["gp"].get(pid, 0) else 0)
        return min(0.9, max(0.1, gp / team)) if team else 0.5

    def add(pid: int, kind: str, stat: str, have: float, target: float, rate: float, basis: int, goalie: bool, **extra):
        p = players[pid]
        need = target - have
        if stat == "gp":
            k = games_needed(need, 1.0)
        elif stat in ("pstreak", "gstreak", "ironman"):
            k = int(need)
        else:
            k = games_needed(need, rate)
        if k is None:
            return
        share = start_share(pid, p["team"]) if goalie else 1.0
        tg = team_games_for(k, share)
        if kind in ("career", "pony") and extra.get("club", 0) > (RARE_CLUB if kind == "career" else 25) and tg > NEAR_GAMES:
            return
        e = eta(ctx, p["team"], pid, tg)
        if e is None:
            return
        item = {"p": pid, "kind": kind, "stat": stat, "have": round(have, 2) if stat == "ixg" else int(have),
                "target": round(target, 2) if stat == "ixg" else int(target),
                "need": round(need, 2) if stat == "ixg" else int(round(need)),
                "rate": round(rate, 3), "eta": e}
        if need <= ONE_GAME.get(stat, 0):
            item["one"] = 1
        if basis < MIN_BASIS and stat not in ("gp", "pstreak", "gstreak", "ironman"):
            item["n"] = int(basis)
        item.update({k2: v for k2, v in extra.items() if v is not None})
        items.append(item)

    for pid, p in players.items():
        goalie = p["goalie"]
        t = gk if goalie else sk
        if not t["car"]["gp"].get(pid):
            continue
        # Career round numbers.
        for key in (GOALIE_CAREER if goalie else SKATER_CAREER):
            have = t["car"][key].get(pid, 0)
            target = next_rung(have, LADDERS[key])
            if target is None:
                continue
            rate, basis = rate_for(pid, key, goalie)
            if key == "fow" and have < 100:
                continue
            add(pid, "career", key, have, target, rate, basis, goalie, club=club_size(target, t["car"][key].values()))

        # All-time list: the next name and the highest Hall of Famer within reach.
        for key in (GOALIE_ALLTIME if goalie else SKATER_ALLTIME):
            have = t["car"][key].get(pid, 0)
            ups = passes(have, pid, at_groups[("g" if goalie else "s", key)])
            if not ups:
                continue
            rate, basis = rate_for(pid, key, goalie)
            reach = have + rate * len(ctx.remaining(p["team"], pid)) * (start_share(pid, p["team"]) if goalie else 1)
            shown = set()
            nxt = ups[0]
            legend = next((u for u in reversed(ups) if u[1] + 1 <= reach and any(i in hof for i in u[2])), None)
            now = rank_now(have, pid, t["car"][key])
            for u in (nxt, legend):
                if u is None or u[0] in shown:
                    continue
                shown.add(u[0])
                rank, val, ids = u
                k = ups.index(u)
                ids = sorted(ids, key=lambda i: (i not in hof, i not in players, names.get(i, "")))
                add(pid, "alltime", key, have, val + 1, rate, basis, goalie, rank=rank,
                    who=[ids[0], names.get(ids[0], ""), int(val), int(ids[0] in hof), int(ids[0] in players)],
                    tied=len(ids) - 1 or None, ladder=ladder(ups, k, names, hof, players, t["car"]["gp"]), now=now, gap=k or None,
                    ngp=int(t["car"]["gp"].get(pid, 0)))

        # Franchise top 10.
        ft = (fr_gk if goalie else fr_sk).get(p["team"])
        if ft:
            for key in (GOALIE_FRANCHISE if goalie else SKATER_FRANCHISE):
                have = ft[key].get(pid, 0)
                if not have:
                    continue
                ups = passes(have, pid, fr_groups[(p["team"], goalie, key)])
                if not ups:
                    continue
                rank, val, ids = ups[0]
                ids = sorted(ids, key=lambda i: (i not in hof, names.get(i, "")))
                rate, basis = rate_for(pid, key, goalie)
                add(pid, "franchise", key, have, val + 1, rate, basis, goalie, rank=rank, fr=p["team"],
                    who=[ids[0], names.get(ids[0], ""), int(val), int(ids[0] in hof), int(ids[0] in players)],
                    tied=len(ids) - 1 or None, ladder=ladder(ups, 0, names, hof, players, ft["gp"]),
                    now=rank_now(have, pid, ft[key]), ngp=int(ft["gp"].get(pid, 0)))

        # pony xG: ixG since the archive's first season.
        if not goalie and since is not None and pid in ixg_tot:
            have = ixg_tot[pid]
            target = next_rung(have, LADDERS["ixg"])
            gp = sk["cur"]["gp"].get(pid, 0) + sk["prev"]["gp"].get(pid, 0)
            rate = ixg_two.get(pid, 0.0) / gp if gp else 0.0
            if target is not None:
                add(pid, "pony", "ixg", have, target, rate, gp, False, club=club_size(target, ixg_tot.values()))

    # Season: pace and the race to be first.
    for key in ("g", "p", "w"):
        goalie = key == "w"
        t = gk if goalie else sk
        cur = t["cur"][key]
        rostered = {pid: v for pid, v in cur.items() if pid in players and players[pid]["goalie"] == goalie}
        for pid, have in rostered.items():
            gp = t["cur"]["gp"].get(pid, 0)
            if not gp:
                continue
            tri = players[pid]["team"]
            rate = have / gp
            share = start_share(pid, tri) if goalie else 1.0
            pace = have + rate * share * len(ctx.remaining(tri, pid))
            if key in PACE and pace >= PACE[key] and have < PACE[key]:
                add(pid, "season", key, have, PACE[key], rate, gp, goalie, pace=int(round(pace)))
        if key in RACE:
            best = max(cur.values(), default=0)
            target = next((m for m in RACE[key] if m > best), None)
            if target:
                for pid, have in rostered.items():
                    gp = t["cur"]["gp"].get(pid, 0)
                    if gp and target - have <= RACE_WITHIN[key]:
                        add(pid, "season", key, have, target, have / gp, gp, goalie, race=1)

    # Streaks from the per-game logs.
    sg = skater_games()
    if not sg.empty:
        best_p = best_g = (0, None)
        runs = []
        for pid, g in sg.groupby("player_id"):
            pts, gls = list(g["points"] > 0), list(g["goals"] > 0)
            lp, lg = longest(pts), longest(gls)
            if lp > best_p[0]:
                best_p = (lp, int(pid))
            if lg > best_g[0]:
                best_g = (lg, int(pid))
            runs.append((int(pid), streak(pts), streak(gls)))
        for pid, sp, sgl in runs:
            if pid not in players:
                continue
            for stat, have, floor, best in (("pstreak", sp, 5, best_p), ("gstreak", sgl, 3, best_g)):
                if have < floor:
                    continue
                target = next_rung(have, sorted({*STREAK_LADDER, best[0] + 1}) if best[1] != pid else STREAK_LADDER)
                if target:
                    add(pid, "streak", stat, have, target, 1.0, have, False,
                        best=[best[0], best[1], names.get(best[1], "")] if best[1] else None)

    # Iron man: consecutive regular-season games played.
    clubs = {pid: p["team"] for pid, p in players.items() if not p["goalie"]}
    iron = ironman_streaks(sg, clubs, ironman_tails(sorted(clubs)))
    if iron:
        top = max(iron.items(), key=lambda x: (x[1], -x[0]))
        best = [top[1], top[0], names.get(top[0], "")]
        for pid, have in iron.items():
            target = next_rung(have, sorted({*IRONMAN_LADDER, top[1] + 1}) if pid != top[0] else IRONMAN_LADDER)
            if target is None:
                continue
            # Common hundreds only inside the next NEAR_GAMES; rare ones and passing the leader all season.
            if target - have > NEAR_GAMES and target < IRONMAN_RARE and target != top[1] + 1:
                continue
            add(pid, "streak", "ironman", have, target, 1.0, have, False, best=best)

    # Recently crossed round numbers.
    recent = []
    cutoff = (ctx.today - timedelta(days=RECENT_DAYS)).isoformat()
    if not sg.empty:
        col = {"gp": None, "g": "goals", "a": "assists", "p": "points", "ppg": "pp_goals", "ppp": "pp_points"}
        for pid, g in sg.groupby("player_id"):
            pid = int(pid)
            if pid not in players or players[pid]["goalie"]:
                continue
            for key, c in col.items():
                car = sk["car"][key].get(pid, 0)
                vals = [1] * len(g) if c is None else list(g[c])
                run = car - sum(vals)
                for (_, row), v in zip(g.iterrows(), vals):
                    before, run = run, run + v
                    m = next_rung(before, LADDERS[key])
                    if v and m is not None and run >= m and row["date"] >= cutoff:
                        recent.append({"p": pid, "stat": key, "target": m, "date": row["date"],
                                       "game": int(row["game_id"]), "opp": row["opp"],
                                       "club": club_size(m, sk["car"][key].values())})
    gg = _stats("goalie", "summary", cur_exp, game=True)
    by_goalie: dict[int, list[dict]] = {}
    for r in gg:
        by_goalie.setdefault(int(r["playerId"]), []).append(r)
    for pid, rows in by_goalie.items():
        if pid not in players:
            continue
        rows.sort(key=lambda r: (r["gameDate"], r["gameId"]))
        for key, f in GOALIE_FIELDS.items():
            car = gk["car"][key].get(pid, 0)
            run = car - sum(r.get(f) or 0 for r in rows)
            for r in rows:
                v = r.get(f) or 0
                before, run = run, run + v
                m = next_rung(before, LADDERS[key])
                if v and m is not None and run >= m and r["gameDate"] >= cutoff:
                    recent.append({"p": pid, "stat": key, "target": m, "date": r["gameDate"], "game": int(r["gameId"]),
                                   "opp": r.get("opponentTeamAbbrev"), "club": club_size(m, gk["car"][key].values())})
    recent.sort(key=lambda r: (r["date"], r["club"] * -1), reverse=True)

    # Players referenced, and each team's next game.
    used = {i["p"] for i in items} | {r["p"] for r in recent}
    out_players = {str(pid): [players[pid]["first"], players[pid]["last"], players[pid]["pos"], players[pid]["team"],
                              out_tag(ctx.inj.get(pid))] for pid in sorted(used)}
    nxt = {}
    for tri, games in ctx.sched.items():
        g = next((x for x in games if not x["done"]), None)
        if g:
            nxt[tri] = [g["id"], g["date"], g["start"], g["opp"], g["home"]]
    assign_places(items)
    items.sort(key=lambda i: (i["eta"][1], i["eta"][4], i["need"]))
    print(f"  milestones: {len(items)} upcoming, {len(recent)} recent, {time.time() - t0:.1f}s")
    return {"season": SEASON_ID, "built_at": utc_now_iso(), "since_ixg": since, "players": out_players,
            "next": nxt, "items": items, "recent": recent}


def main(argv=None):
    doc = build()
    doc = keep_if_unchanged(read_json(OUT), doc, keys=VOLATILE_KEYS | {"built_at"})
    ok = atomic_write_json(OUT, doc, min_items=1, indent=None, separators=(",", ":"), label="milestones.json",
                           validator=lambda d: None if d.get("items") else "no milestones")
    print(f"  milestones.json {os.path.getsize(OUT) / 1024:.0f} KB")
    return {"status": "ok" if ok else "skip", "rows_written": len(doc["items"]) if ok else 0}


if __name__ == "__main__":
    main()
