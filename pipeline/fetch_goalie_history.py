"""fetch_goalie_history.py - a goalie's CAREER record against one opponent.

* Seasons come from season.py: the current season and the 10 before it,
  regular season (2) and playoffs (3) for every season the player has
  (the game-log response lists them in ``playerStatsSeasons``).
* GAA uses time on ice (GA x 60 / minutes), so a 20-minute relief outing
  counts 20 minutes, not a full game.
* Past seasons never change: their per-opponent splits are cached in
  pipeline/goalie_vs_opp_cache.json together with the name -> id map, so a
  warm cache costs at most 2 API calls per goalie (this season's regular
  season and, when the player has any, this season's playoffs).
* ``vs_opp_gp`` is always returned; the line itself is blanked below
  MIN_GP games (3) so a 1-game sample never reads like a trend.

Output of fetch_goalie_vs_opponent (or None when the goalie can't be found):
    {"vs_opp_gp": 8, "record": "6-1-1", "sv": 0.924, "gaa": 2.0,
     "toi_min": 478.5, "opponent": "VAN", "seasons": "2016-17..2026-27",
     "label": "Career vs VAN (8 GP)"}
record/sv/gaa are omitted (and label says so) when vs_opp_gp < MIN_GP.
"""
from __future__ import annotations

import json
import os

from season import SEASON_ID, START_YEAR

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(PIPELINE_DIR, "goalie_vs_opp_cache.json")
SEASONS_BACK = 10
MIN_GP = 3
CACHE_VERSION = 1

ROSTER_CACHE = {}
_CACHE = None
_CACHE_DIRTY = False

# Franchise continuity (Utah took over the Arizona franchise).
FRANCHISE_ALIASES = {"UTA": {"UTA", "ARI"}, "ARI": {"UTA", "ARI"}}
TRICODE_MAP = {"NJ": "NJD", "TB": "TBL", "LA": "LAK", "SJ": "SJS", "MON": "MTL"}


def normalize_tricode(tri):
    if not tri:
        return tri
    tri = tri.upper()
    return TRICODE_MAP.get(tri, tri)


def season_ids(current=SEASON_ID, back=SEASONS_BACK):
    """[current, current-1, ..., current-back] as NHL season ids."""
    y = int(str(current)[:4])
    return [f"{s}{s + 1}" for s in range(y, y - back - 1, -1)]


def season_label(sid):
    return f"{str(sid)[:4]}-{str(sid)[6:8]}"


def toi_minutes(toi):
    """'MM:SS' -> minutes (float)."""
    try:
        m, s = str(toi).split(":")
        return int(m) + int(s) / 60
    except (ValueError, AttributeError):
        return 0.0


def split_by_opponent(game_log):
    """{opponent: {gp, w, l, ot, sa, ga, toi_min}} from a game-log list."""
    out = {}
    for g in game_log or []:
        opp = g.get("opponentAbbrev")
        if not opp:
            continue
        s = out.setdefault(opp, {"gp": 0, "w": 0, "l": 0, "ot": 0, "sa": 0, "ga": 0, "toi_min": 0.0})
        s["gp"] += 1
        dec = g.get("decision")
        if dec == "W":
            s["w"] += 1
        elif dec == "L":
            s["l"] += 1
        elif dec in ("O", "OT", "OTL", "SO"):
            s["ot"] += 1
        s["sa"] += int(g.get("shotsAgainst") or 0)
        s["ga"] += int(g.get("goalsAgainst") or 0)
        s["toi_min"] += toi_minutes(g.get("toi"))
    for s in out.values():
        s["toi_min"] = round(s["toi_min"], 2)
    return out


def summarize(splits, opponents, opponent_label, seasons_label=""):
    """Aggregate per-season splits for the opponent set into the output dict."""
    tot = {"gp": 0, "w": 0, "l": 0, "ot": 0, "sa": 0, "ga": 0, "toi_min": 0.0}
    for per_opp in splits:
        for opp in opponents:
            s = per_opp.get(opp)
            if s:
                for k in tot:
                    tot[k] += s[k]
    n = tot["gp"]
    out = {"vs_opp_gp": n, "opponent": opponent_label, "seasons": seasons_label}
    if n < MIN_GP:
        out["label"] = f"Career vs {opponent_label}: {n} GP (too few to show)"
        return out
    sv = (tot["sa"] - tot["ga"]) / tot["sa"] if tot["sa"] else 0.0
    gaa = tot["ga"] * 60 / tot["toi_min"] if tot["toi_min"] else 0.0
    out.update({
        "record": f"{tot['w']}-{tot['l']}-{tot['ot']}",
        "sv": round(sv, 3),
        "gaa": round(gaa, 2),
        "gp": n,
        "toi_min": round(tot["toi_min"], 1),
        "win_pct": round(tot["w"] / n, 3),
        "label": f"Career vs {opponent_label} ({n} GP)",
    })
    return out


# ── cache ────────────────────────────────────────────────────────────────────

def _load_cache():
    global _CACHE
    if _CACHE is None:
        try:
            with open(CACHE_FILE) as f:
                _CACHE = json.load(f)
            if _CACHE.get("version") != CACHE_VERSION:
                _CACHE = None
        except (OSError, ValueError):
            _CACHE = None
        if _CACHE is None:
            _CACHE = {"version": CACHE_VERSION, "ids": {}, "players": {}}
    return _CACHE


def save_cache():
    """Persist the cache if anything new was added this run."""
    global _CACHE_DIRTY
    if not _CACHE_DIRTY or _CACHE is None:
        return False
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(_CACHE, f, indent=0, sort_keys=True)
    os.replace(tmp, CACHE_FILE)
    _CACHE_DIRTY = False
    return True


# ── network ──────────────────────────────────────────────────────────────────

def make_request(url):
    from http_utils import try_get_json
    return try_get_json(url, ua="plain", retries=2)


def fetch_roster(team_tri):
    team_tri = normalize_tricode(team_tri)
    if team_tri in ROSTER_CACHE:
        return ROSTER_CACHE[team_tri]
    data = make_request(f"https://api-web.nhle.com/v1/roster/{team_tri}/current")
    players = []
    if data:
        for group in ("forwards", "defensemen", "goalies"):
            players.extend(data.get(group, []) or [])
    ROSTER_CACHE[team_tri] = players
    return players


def _clean(name):
    return str(name or "").lower().replace(".", "").strip()


def find_player_id(name, team_tri):
    """Player id from the cache, else the team's current roster."""
    global _CACHE_DIRTY
    cache = _load_cache()
    key = _clean(name)
    if key in cache["ids"]:
        return cache["ids"][key]
    roster = fetch_roster(team_tri)
    pid = None
    for p in roster:
        full = _clean(f"{p['firstName']['default']} {p['lastName']['default']}")
        if full == key:
            pid = p["id"]
            break
    if pid is None and key:
        last = key.split(" ")[-1]
        cands = [p for p in roster if p["lastName"]["default"].lower() == last]
        if len(cands) == 1:
            pid = cands[0]["id"]
        elif len(cands) > 1:
            pid = next((p["id"] for p in cands if p["firstName"]["default"].lower().startswith(key[0])), None)
    if pid is not None:
        cache["ids"][key] = pid
        _CACHE_DIRTY = True
    return pid


def _game_log(pid, sid, gtype):
    return make_request(f"https://api-web.nhle.com/v1/player/{pid}/game-log/{sid}/{gtype}")


def player_splits(pid, current=SEASON_ID):
    """Per-(season, type) opponent splits for the last 11 seasons.

    Returns a list of {opp: split}.  Current-season logs are fetched every
    call; past seasons come from the cache (fetched once, then cached)."""
    global _CACHE_DIRTY
    cache = _load_cache()
    wanted = set(season_ids(current))
    pc = cache["players"].setdefault(str(pid), {"seasons": None, "splits": {}})
    splits = []
    cur = _game_log(pid, current, 2)
    if cur is None:
        cur = {}
    splits.append(split_by_opponent(cur.get("gameLog")))
    listed = cur.get("playerStatsSeasons")
    if listed is not None:
        avail = sorted({(str(s.get("season")), int(t)) for s in listed
                        for t in (s.get("gameTypes") or []) if str(s.get("season")) in wanted})
        if pc["seasons"] != [list(x) for x in avail]:
            pc["seasons"] = [list(x) for x in avail]
            _CACHE_DIRTY = True
    avail = [tuple(x) for x in (pc["seasons"] or [])]
    for sid, gtype in avail:
        if sid == str(current):
            if gtype == 3:
                log = _game_log(pid, sid, 3) or {}
                splits.append(split_by_opponent(log.get("gameLog")))
            continue
        k = f"{sid}-{gtype}"
        if k not in pc["splits"]:
            log = _game_log(pid, sid, gtype)
            if log is None:
                continue          # network failure: try again next run
            pc["splits"][k] = split_by_opponent(log.get("gameLog"))
            _CACHE_DIRTY = True
        splits.append(pc["splits"][k])
    return splits


def fetch_goalie_vs_opponent(player_name, team_tri, opponent_tri):
    """Career line of ``player_name`` against ``opponent_tri`` (see module doc)."""
    opponent_tri = normalize_tricode(opponent_tri)
    pid = find_player_id(player_name, team_tri)
    if not pid:
        print(f"  Warning: could not find ID for {player_name} ({team_tri})")
        return None
    splits = player_splits(pid)
    seasons = season_ids()
    label = f"{season_label(seasons[-1])}..{season_label(seasons[0])}"
    return summarize(splits, FRANCHISE_ALIASES.get(opponent_tri, {opponent_tri}), opponent_tri, label)


if __name__ == "__main__":
    from http_utils import request_count
    print(fetch_goalie_vs_opponent("Igor Shesterkin", "NYR", "NJD"))
    save_cache()
    print("API calls:", request_count("api-web"))
