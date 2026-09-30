"""season_context.py - season-scoped matchup context for predict_games.

Every value here is scoped to the current season (``season.SEASON_ID``),
gated on sample size, and returned EMPTY (``''`` / ``None``) rather than as a
neutral placeholder when there is nothing to show.  Values that come from the
previous season are only ever written to ``*_prev`` fields, and the caller
sets ``context_season`` whenever one is used (see pipeline/CONTRACT.md).

The functions are pure (they take already-loaded data) so they can be unit
tested and reused by the fixture generator; the few loaders at the bottom do
the network / disk I/O.

Sources
-------
* Club schedules  api-web /v1/club-schedule-season/{TRI}/{SEASON_ID}: every
  game of the season with type, state, start time and final score.  Used for
  the last-N record, head-to-head, home/road record, games played and the
  full-schedule fatigue flags (scheduled games count, so a team that played
  last night is on a back-to-back even before last night's game is scraped).
* Special teams   api.nhle.com stats team/powerplay + team/penaltykill.
* Standings       api-web /v1/standings/{date} (games played for all 32).
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone

from season import (SEASON_ID, PREV_SEASON_ID, START_YEAR, SEASON_START_DATE, PLAYOFFS,
                    REGULAR_SEASON, today_local)

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(PIPELINE_DIR, "cache", "club_schedule")

FINAL_STATES = {"OFF", "FINAL"}
PREGAME_STATES = {"FUT", "PRE"}

LAST_N = 7                  # window of the "L7" record
LOC_MIN_GAMES = 5           # home/road record needs this many location games
ST_MIN_GP = 10              # PP/PK ranks only once EVERY team has this many GP
ST_PRIOR_OPPS = 30          # regression of PP%/PK% (same prior as team_ratings.py)
ST_LEAGUE_PRIOR_PP = 0.20   # league PP% prior before there is data
ST_LEAGUE_PRIOR_OPPS = 500  # weight of that prior in the league average
CLUB_SCHEDULE_MAX_AGE_H = 1.0


# ── time helpers ─────────────────────────────────────────────────────────────

def parse_utc(s):
    """ISO-8601 'Z' (or offset) string -> aware UTC datetime, or None."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def iso_z(d):
    """Aware datetime -> 'YYYY-MM-DDTHH:MM:SSZ'."""
    if d is None:
        return ""
    return d.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _d(s):
    return date.fromisoformat(str(s)[:10])


# ── club schedules ───────────────────────────────────────────────────────────

def normalize_game(g):
    """One api-web schedule game -> the small dict the helpers use."""
    home, away = g.get("homeTeam") or {}, g.get("awayTeam") or {}
    return {
        "id": int(g["id"]),
        "date": g.get("gameDate") or str(g.get("startTimeUTC", ""))[:10],
        "start_utc": g.get("startTimeUTC"),
        "type": int(g.get("gameType") or 0),
        "state": g.get("gameState") or "FUT",
        "home": home.get("abbrev"),
        "away": away.get("abbrev"),
        "home_score": home.get("score"),
        "away_score": away.get("score"),
        "last_period": ((g.get("gameOutcome") or {}).get("lastPeriodType")
                        or (g.get("periodDescriptor") or {}).get("periodType") or "REG"),
    }


def is_final(g):
    return g["state"] in FINAL_STATES and g["home_score"] is not None and g["away_score"] is not None


def _result_due(games, now):
    """A counted game started > 3 h ago but the cached copy has no final."""
    for g in games:
        st = parse_utc(g.get("start_utc"))
        if g["type"] in (2, 3) and st and st < now - timedelta(hours=3) and not is_final(g):
            return True
    return False


def load_club_schedule(tri, season_id=SEASON_ID, now=None, max_age_hours=CLUB_SCHEDULE_MAX_AGE_H,
                       cache_dir=CACHE_DIR, fetch=True):
    """Normalized games of ``tri``'s season (all game types), cached on disk.

    The cache is reused while younger than ``max_age_hours`` unless a result
    is due; a failed fetch falls back to the stale cache."""
    now = now or datetime.now(timezone.utc)
    path = os.path.join(cache_dir, f"{tri}_{season_id}.json")
    cached = None
    try:
        with open(path) as f:
            cached = json.load(f)
    except (OSError, ValueError):
        cached = None
    if cached is not None:
        age_h = (time.time() - cached.get("fetched_ts", 0)) / 3600
        games = cached.get("games", [])
        if not fetch or (age_h < max_age_hours and not _result_due(games, now)):
            return games
    if not fetch:
        return []
    try:
        from http_utils import get_json
        data = get_json(f"https://api-web.nhle.com/v1/club-schedule-season/{tri}/{season_id}", ua="plain")
        games = [normalize_game(g) for g in data.get("games", []) if g.get("id")]
    except Exception as e:  # network or payload problem: stale cache beats nothing
        print(f"  [WARN] club schedule {tri} {season_id}: {e}")
        return (cached or {}).get("games", [])
    try:
        os.makedirs(cache_dir, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"fetched_ts": time.time(), "games": games}, f)
        os.replace(tmp, path)
    except OSError:
        pass
    return games


def team_games(games, tri):
    """Games of ``tri`` sorted by start time (ascending)."""
    out = [g for g in games if tri in (g.get("home"), g.get("away"))]
    return sorted(out, key=lambda g: (g.get("start_utc") or g["date"], g["id"]))


# ── results ──────────────────────────────────────────────────────────────────

def result_for(g, tri):
    """(bucket, code) for ``tri`` in a final game.

    bucket is 'W', 'L' or 'O' (OT/SO loss, regular season only); a playoff
    overtime loss is an 'L' (the playoffs have no loser point)."""
    home = g["home"] == tri
    mine = g["home_score"] if home else g["away_score"]
    theirs = g["away_score"] if home else g["home_score"]
    period = g.get("last_period") or "REG"
    playoff = g["type"] == 3
    if mine > theirs:
        return "W", "W" if period == "REG" else f"W-{period}"
    if period in ("OT", "SO"):
        return ("L", f"L-{period}") if playoff else ("O", "O")
    return "L", "L"


def record(results):
    """'W-L-OTL' (always three parts) from a list of buckets."""
    return f"{results.count('W')}-{results.count('L')}-{results.count('O')}"


def counted_types(game_type):
    """Game types that count for a game of ``game_type`` ('02' / '03')."""
    return (2, 3) if str(game_type).zfill(2) == PLAYOFFS else (2,)


def completed_before(games, tri, game_date, types=(2,), before_start=None):
    """Final games of ``tri`` of the given types strictly before the target game."""
    gd = str(game_date)[:10]
    out = []
    for g in team_games(games, tri):
        if g["type"] not in types or not is_final(g):
            continue
        if before_start is not None:
            st = parse_utc(g.get("start_utc"))
            if st is not None and st >= before_start:
                continue
        elif g["date"] >= gd:
            continue
        out.append(g)
    return out


def games_played(games, tri, game_date, before_start=None):
    """Current-season regular-season GP before the target game."""
    return len(completed_before(games, tri, game_date, (2,), before_start))


def last_n(games, tri, game_date, game_type=REGULAR_SEASON, n=LAST_N, starter_lookup=None,
           common_name=None, before_start=None):
    """Last-N record and game list for ``tri``.

    Returns {record, n, label, games}.  record is '' at 0 completed games;
    label is 'L7' once 7 games are in and 'L<k>' before.  Game numbers come
    from an ascending sort with separate counters per game type
    ('G12' regular season, 'PO G3' playoffs), so the newest game has the
    highest number."""
    types = counted_types(game_type)
    done = completed_before(games, tri, game_date, types, before_start)
    numbers, counters = {}, {2: 0, 3: 0}
    for g in done:                                    # ascending
        counters[g["type"]] += 1
        numbers[g["id"]] = (f"PO G{counters[3]}" if g["type"] == 3 else f"G{counters[2]}")
    recent = done[-n:][::-1]                          # newest first
    if not recent:
        return {"record": "", "n": 0, "label": "", "games": []}
    buckets, rows = [], []
    for g in recent:
        bucket, code = result_for(g, tri)
        buckets.append(bucket)
        home = g["home"] == tri
        d = _d(g["date"])
        starter = ""
        if starter_lookup and common_name:
            starter = starter_lookup.get((g["date"], common_name), "") or ""
        rows.append({
            "date": f"{d.month}/{d.day}",
            "gameDate": g["date"],
            "gameId": g["id"],
            "gameType": f"{g['type']:02d}",
            "gameNumber": numbers[g["id"]],
            "opponent": g["away"] if home else g["home"],
            "isHome": home,
            "score": f"{g['home_score'] if home else g['away_score']}-{g['away_score'] if home else g['home_score']}",
            "result": code,
            "starter": starter,
        })
    k = len(recent)
    return {"record": record(buckets), "n": k, "label": f"L{k}", "games": rows}


def head_to_head(games, home, away, game_date, before_start=None):
    """This season's regular-season meetings before tonight.

    Returns (home_record, away_record, meetings); records are '' when the
    teams have not met yet and always 'W-L-OTL' otherwise."""
    meet = [g for g in completed_before(games, home, game_date, (2,), before_start)
            if away in (g["home"], g["away"])]
    if not meet:
        return "", "", 0
    h = [result_for(g, home)[0] for g in meet]
    a = [result_for(g, away)[0] for g in meet]
    return record(h), record(a), len(meet)


def head_to_head_from_gamestats(df, home_common, away_common, start_year):
    """Regular-season H2H of a past season from a gamestats frame (team rows
    with common names and RW/RL/OTW/OTL/SOW/SOL results).  Returns
    (home_record, away_record, meetings)."""
    if df is None or getattr(df, "empty", True):
        return "", "", 0
    ids = df["game_id"].astype(str)
    sel = df[(ids.str[:4] == str(start_year)) & (ids.str[4:6] == REGULAR_SEASON)
             & (df["team"] == home_common) & (df["opponent"] == away_common)]
    if sel.empty:
        return "", "", 0
    h, a = [], []
    for res in sel["result"].astype(str):
        if res in ("RW", "OTW", "SOW"):
            h.append("W")
            a.append("L" if res == "RW" else "O")
        elif res in ("RL", "OTL", "SOL"):
            a.append("W")
            h.append("L" if res == "RL" else "O")
    return record(h), record(a), len(sel)


def location_record(games, tri, game_date, at_home, min_games=LOC_MIN_GAMES, before_start=None):
    """Regular-season record at home (``at_home``) or on the road.

    Returns (record, games); record is '' below ``min_games``."""
    done = [g for g in completed_before(games, tri, game_date, (2,), before_start)
            if (g["home"] == tri) == bool(at_home)]
    n = len(done)
    if n < min_games:
        return "", n
    return record([result_for(g, tri)[0] for g in done]), n


def fatigue(games, tri, game_id, game_date):
    """Schedule context from the FULL club schedule (played and scheduled).

    rest_days       days off since the previous game (0 = back-to-back);
                    regular-season/playoff games count, preseason only when
                    the team has no counted game before tonight (openers).
    is_b2b          played the previous day.
    games_in_last_N games (incl. tonight) in the N days ending tonight.
    road_trip_game_n consecutive road games ending with tonight (0 at home).
    model_rest_days days since the previous counted game for the game model
                    (None when there is none this season: the model then
                    uses its own state, as in training).
    """
    gd = _d(game_date)
    mine = team_games(games, tri)
    target = next((g for g in mine if g["id"] == int(game_id)), None) if game_id else None
    tstart = parse_utc(target["start_utc"]) if target else None

    def before(g):
        if target is not None and g["id"] == target["id"]:
            return False
        st = parse_utc(g.get("start_utc"))
        if tstart is not None and st is not None:
            return st < tstart
        return _d(g["date"]) < gd

    prior = [g for g in mine if before(g)]
    counted = [g for g in prior if g["type"] in (2, 3)]
    ref = counted or [g for g in prior if g["type"] == 1]
    rest_days = (gd - _d(ref[-1]["date"])).days - 1 if ref else None
    model_rest = (gd - _d(counted[-1]["date"])).days if counted else None
    dates = [_d(g["date"]) for g in counted] + [gd]

    def in_last(n):
        lo = gd - timedelta(days=n - 1)
        return sum(1 for d in dates if lo <= d <= gd)

    trip = 0
    if target is not None and target["away"] == tri:
        trip = 1
        for g in reversed(counted):
            if g["away"] == tri:
                trip += 1
            else:
                break
    elif target is None:
        trip = 0
    return {
        "rest_days": max(0, rest_days) if rest_days is not None else None,
        "is_b2b": rest_days == 0 if rest_days is not None else False,
        "games_in_last_4": in_last(4),
        "games_in_last_6": in_last(6),
        "games_in_last_9": in_last(9),
        "road_trip_game_n": trip,
        "model_rest_days": model_rest,
    }


# ── special teams ────────────────────────────────────────────────────────────

def special_teams_table(pp_rows, pk_rows, gp_by_tri, id_to_tri, all_tris,
                        min_gp=ST_MIN_GP, prior_opps=ST_PRIOR_OPPS):
    """PP/PK context for every team.

    pp_rows / pk_rows: stats API team/powerplay and team/penaltykill rows
    (teams with >= 1 GP).  All 32 teams are ranked on the REGRESSED rate
    (goals + prior_opps x league rate) / (opportunities + prior_opps), so a
    1-for-2 night cannot top the table.  Ranks are published only when every
    team has >= ``min_gp`` games; otherwise pp_rank/pk_rank are None.
    pp_pct / pk_pct are the actual season rates (fractions) for tooltips,
    None without opportunities."""
    pp = {id_to_tri.get(r.get("teamId")): r for r in pp_rows or []}
    pk = {id_to_tri.get(r.get("teamId")): r for r in pk_rows or []}
    tot_g = sum((r.get("powerPlayGoalsFor") or 0) for r in pp.values())
    tot_o = sum((r.get("ppOpportunities") or 0) for r in pp.values())
    league_pp = (tot_g + ST_LEAGUE_PRIOR_OPPS * ST_LEAGUE_PRIOR_PP) / (tot_o + ST_LEAGUE_PRIOR_OPPS)
    table = {}
    for tri in all_tris:
        p, k = pp.get(tri) or {}, pk.get(tri) or {}
        ppg, ppo = p.get("powerPlayGoalsFor") or 0, p.get("ppOpportunities") or 0
        ga, sh = k.get("ppGoalsAgainst") or 0, k.get("timesShorthanded") or 0
        table[tri] = {
            "gp": int(gp_by_tri.get(tri, 0) or 0),
            "pp_opps": int(ppo), "pk_opps": int(sh),
            "pp_pct": round(ppg / ppo, 4) if ppo else None,
            "pk_pct": round(1 - ga / sh, 4) if sh else None,
            "_pp_reg": (ppg + prior_opps * league_pp) / (ppo + prior_opps),
            "_pk_reg": 1 - (ga + prior_opps * league_pp) / (sh + prior_opps),
        }
    ranked = all(t["gp"] >= min_gp for t in table.values()) and len(table) == len(all_tris) and table
    pp_order = sorted(table, key=lambda t: (-table[t]["_pp_reg"], t))
    pk_order = sorted(table, key=lambda t: (-table[t]["_pk_reg"], t))
    for i, t in enumerate(pp_order):
        table[t]["pp_rank"] = i + 1 if ranked else None
    for i, t in enumerate(pk_order):
        table[t]["pk_rank"] = i + 1 if ranked else None
    for t in table.values():
        t["pp_rate_regressed"] = round(t.pop("_pp_reg"), 4)
        t["pk_rate_regressed"] = round(t.pop("_pk_reg"), 4)
    return table


def rank_season_table(summary_rows, id_to_tri):
    """Final PP/PK ranks of a completed season from stats team/summary rows
    (ranked on the raw season rates, which is what the NHL publishes)."""
    rows = [r for r in summary_rows or [] if id_to_tri.get(r.get("teamId"))]
    pp = sorted(rows, key=lambda r: -(r.get("powerPlayPct") or 0))
    pk = sorted(rows, key=lambda r: -(r.get("penaltyKillPct") or 0))
    out = {}
    for i, r in enumerate(pp):
        out.setdefault(id_to_tri[r["teamId"]], {})["pp_rank"] = i + 1
        out[id_to_tri[r["teamId"]]]["pp_pct"] = round(r.get("powerPlayPct") or 0, 4)
    for i, r in enumerate(pk):
        out[id_to_tri[r["teamId"]]]["pk_rank"] = i + 1
        out[id_to_tri[r["teamId"]]]["pk_pct"] = round(r.get("penaltyKillPct") or 0, 4)
    return out


def _stats_rows(report, season_id):
    from http_utils import get_json
    url = (f"https://api.nhle.com/stats/rest/en/team/{report}?isAggregate=false&isGame=false&limit=-1"
           f"&cayenneExp=gameTypeId=2%20and%20seasonId={season_id}")
    return get_json(url, ua="plain").get("data", []) or []


def fetch_special_teams(gp_by_tri, id_to_tri, all_tris, season_id=SEASON_ID):
    """Current-season table (see special_teams_table); {} on failure."""
    try:
        pp, pk = _stats_rows("powerplay", season_id), _stats_rows("penaltykill", season_id)
    except Exception as e:
        print(f"  [WARN] special teams stats unavailable: {e}")
        pp, pk = [], []
    return special_teams_table(pp, pk, gp_by_tri, id_to_tri, all_tris)


def fetch_prev_season_ranks(id_to_tri, season_id=PREV_SEASON_ID):
    """Final regular-season PP/PK ranks of the previous season (these match
    the gamecenter right-rail teamSeasonStats ranks); {} on failure."""
    try:
        return rank_season_table(_stats_rows("summary", season_id), id_to_tri)
    except Exception as e:
        print(f"  [WARN] {season_id} special-teams ranks unavailable: {e}")
        return {}


def fetch_standings_gp(now=None):
    """{TRI: regular-season GP} for the current season (standings of today's
    NHL date, checked against SEASON_ID); {} when unavailable."""
    from http_utils import try_get_json
    day = today_local(now).isoformat()
    data = try_get_json(f"https://api-web.nhle.com/v1/standings/{day}", ua="plain") or {}
    out = {}
    for t in data.get("standings", []) or []:
        if str(t.get("seasonId")) != SEASON_ID:
            continue
        tri = (t.get("teamAbbrev") or {}).get("default")
        if tri:
            out[tri] = int(t.get("gamesPlayed") or 0)
    return out


def postseason_games_exist(now=None, upcoming=None, fetch=True):
    """True when playoff (gameType 3) games are on the schedule: in
    upcoming_games.json, or in the NHL schedule week around today.  One
    small request at most, so callers can bail out fast in the regular
    season."""
    if upcoming is None:
        try:
            with open(os.path.join(PIPELINE_DIR, "upcoming_games.json")) as f:
                upcoming = json.load(f)
        except (OSError, ValueError):
            upcoming = []
    if any(int(g.get("gameType") or 0) == 3 for g in upcoming or []):
        return True
    if not fetch:
        return False
    from http_utils import try_get_json
    day = today_local(now).isoformat()
    data = try_get_json(f"https://api-web.nhle.com/v1/schedule/{day}", ua="plain", retries=2) or {}
    return any(int(g.get("gameType") or 0) == 3
               for wk in data.get("gameWeek", []) or [] for g in wk.get("games", []) or [])


# ── goalie lines ─────────────────────────────────────────────────────────────

def format_goalie_line(s):
    """{w,l,ot,svpct,gaa,gp} -> '(W-L-O) | .SV% | GAA' ('' when empty)."""
    if not s or not s.get("gp"):
        return ""
    sv = float(s.get("svpct") or 0)
    sv_str = "1.000" if sv >= 1 else f"{sv:.3f}".lstrip("0")
    return f"({s.get('w', 0)}-{s.get('l', 0)}-{s.get('ot', 0)}) | {sv_str} | {float(s.get('gaa') or 0):.2f}"


def goalie_lines(lines, name):
    """(cur_line, prev_line, cur_gp) for ``name`` from goalie_season_lines."""
    if not name or not lines:
        return "", "", 0
    rec = lines.get(name) or lines.get(str(name).lower().strip())
    if rec is None:
        low = str(name).lower().strip()
        rec = next((v for k, v in lines.items() if k.lower().strip() == low), None)
    if not rec:
        return "", "", 0
    cur, prev = rec.get("cur") or {}, rec.get("prev") or {}
    return format_goalie_line(cur), format_goalie_line(prev), int(cur.get("gp") or 0)


# ── goalie status (A7) ───────────────────────────────────────────────────────

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_AMBIGUOUS_PLACES = {"new york"}     # Rangers and Islanders share it


def opponent_terms(common, tri, full):
    """Names that identify the opponent in a news blurb: the common name
    ('Oilers'), the full name, its place ('Edmonton') and the tricode."""
    terms = [t for t in (common, full) if t]
    if full and common and full.endswith(common):
        place = full[: -len(common)].strip()
        if place and place.lower() not in _AMBIGUOUS_PLACES:
            terms.append(place)
    if tri:
        terms.append(tri)
    return terms


def _names_opponent(text, opponent):
    """Whole-word match: 'EDM' must not match 'Edmonton' (a different team's
    blurb can name a city), and a tricode like 'SEA' or 'CAR' must not match
    'season' or 'career'.  Tricodes (all caps, 3 letters) match case-sensitively."""
    import re
    t = text or ""
    for o in opponent or []:
        if not o:
            continue
        if len(o) == 3 and o.isupper():
            if re.search(rf"\b{re.escape(o)}\b", t):
                return True
        elif re.search(rf"\b{re.escape(o)}\b", t, flags=re.I):
            return True
    return False


def _weekday_conflict(text, game_date):
    """True when the blurb names a weekday that is not the game's weekday
    ('he'll start Tuesday in Edmonton' is not about Thursday's game)."""
    t = (text or "").lower()
    named = {d for d in WEEKDAYS if d in t}
    if not named:
        return False
    return WEEKDAYS[_d(game_date).weekday()] not in named


def news_confirms(news_items, goalie, game_date, opponent_names, not_before=None):
    """The 'Goalie Start' news item that confirms ``goalie`` for THIS game:
    its date equals the game date, or its text names the opponent.

    Guards against confirming from a blurb about another game: an item
    published before ``not_before`` (the start of the team's previous game)
    is about that earlier game, and an item naming a different weekday is
    about another day (home-and-home series name the same opponent twice)."""
    if not goalie:
        return None
    g = goalie.lower()
    last = g.split()[-1]
    for item in news_items or []:
        if item.get("category") != "Goalie Start":
            continue
        who = (item.get("player") or "").lower()
        if not who or not (who in g or g in who or who.split()[-1] == last):
            continue
        text = item.get("news") or ""
        ts = parse_utc(item.get("timestamp"))
        if not_before is not None and ts is not None and ts <= not_before:
            continue
        if _weekday_conflict(text, game_date):
            continue
        if str(item.get("date") or "")[:10] == str(game_date)[:10] or _names_opponent(text, opponent_names):
            return item
    return None


def previous_start(games, tri, before_start):
    """Start (aware UTC) of ``tri``'s latest game, of any type, that starts
    before ``before_start``; None when there is none or no start is known."""
    if before_start is None:
        return None
    prev = None
    for g in team_games(games or [], tri):
        st = parse_utc(g.get("start_utc"))
        if st is not None and st < before_start and (prev is None or st > prev):
            prev = st
    return prev


def resolve_goalie_status(goalie, sched_status, sched_source, dfo_entry, news_items, game_date,
                          opponent_names, observed_at, not_before=None):
    """(status, source, at) for a projected starter.

    status  'Confirmed' / 'Likely' / 'Unconfirmed' / 'Probable (ESPN)' as
            resolved by fetch_upcoming, upgraded to 'Confirmed' only by a
            'Goalie Start' news item tied to this game (see news_confirms).
    source  'DFO', 'ESPN probable', 'news', or '' when nothing is known.
    at      ISO UTC time of the source item (DFO news time, else when the
            pipeline observed it)."""
    status = sched_status or "Unconfirmed"
    source, at = "", ""
    if sched_source == "dailyfaceoff":
        source = "DFO"
        at = iso_z(parse_utc((dfo_entry or {}).get("news_at")) or parse_utc((dfo_entry or {}).get("fetched_at"))
                   or observed_at)
    elif sched_source == "espn":
        source, at = "ESPN probable", iso_z(observed_at)
    item = news_confirms(news_items, goalie, game_date, opponent_names, not_before=not_before)
    if item is not None and status != "Confirmed":
        status, source = "Confirmed", "news"
        at = iso_z(parse_utc(item.get("timestamp")) or observed_at)
    if status == "Confirmed" and not source:
        source, at = "DFO", iso_z(observed_at)
    return status, source, at
