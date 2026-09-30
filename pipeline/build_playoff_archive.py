"""
build_playoff_archive.py - precompute a postseason for /playoffs/[season].

The old /playoffs page parsed ~67MB of season CSVs and made two NHL API calls
per game on every request (TTFB 2.6-9s, a 170MB serverless bundle). This
script does that work once and writes small static JSON:

  public/data/playoffs/<endYear>/summary.json   bracket, every series and game
                                                result, series team totals,
                                                regular-season head-to-head,
                                                playoff leaders (~30KB)
  public/data/playoffs/<endYear>/<gameId>.json  per-game analysis: shots with
                                                xG, skater TOI/on-ice xG, goalie
                                                lines, boxscore extras (fetched
                                                by the page only when a game is
                                                opened)

Sources: NHL api-web playoff bracket + series schedules (results), the
season's pipeline CSVs (gamestats, shots with xG, shifts) and, once per game,
the NHL boxscore and play-by-play for assists/hits/faceoffs and PP/PK TOI.

Usage (from pipeline/):
    python3 build_playoff_archive.py                    # last season (default)
    python3 build_playoff_archive.py --season 20252026
    python3 build_playoff_archive.py --season 20262027  # live postseason refresh

It is idempotent: re-running rewrites the same files. Past seasons are frozen
archives; never delete them.
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import pandas as pd

import season
from http_utils import try_get_json
from paths import PIPELINE_DIR, PUBLIC_DATA_DIR

API = "https://api-web.nhle.com/v1"
ROUND_LABELS = {1: "First round", 2: "Second round", 3: "Conference final", 4: "Stanley Cup Final"}
SCHEMA_VERSION = 1


def r3(x):
    try:
        return round(float(x), 3)
    except (TypeError, ValueError):
        return 0.0


def num(x, default=0.0):
    try:
        v = float(x)
        return default if pd.isna(v) else v
    except (TypeError, ValueError):
        return default


def ident(x):
    """NHL ids arrive as ints, floats ('8479394.0') or strings; normalise to '8479394'."""
    try:
        return str(int(float(x)))
    except (TypeError, ValueError):
        return str(x)


def et_date(start_utc, offset="-04:00"):
    """Local (Eastern) calendar date of a UTC start time."""
    try:
        t = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
        sign = -1 if offset.startswith("-") else 1
        hh, mm = offset[1:].split(":")
        return (t + sign * timedelta(hours=int(hh), minutes=int(mm))).date().isoformat()
    except Exception:
        return (start_utc or "")[:10]


def atomic_write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)


def seed_label(team, rank_abbrev):
    """'D1' + division 'M' -> 'M1'; 'WC2' stays 'WC2'."""
    ra = rank_abbrev or ""
    if ra.startswith("D") and team.get("divisionAbbrev"):
        return f"{team['divisionAbbrev']}{ra[1:]}"
    return ra


def load_team_names():
    df = pd.read_csv(os.path.join(PUBLIC_DATA_DIR, "nhl_teams.csv"))
    names = {}
    common_to_tri = {}
    for _, r in df.iterrows():
        names[r["Team Tricode"]] = {"name": r["Team Name"], "short": r["Common Name"]}
        common_to_tri[r["Common Name"]] = r["Team Tricode"]
    return names, common_to_tri


# ── Per-game analysis ────────────────────────────────────────────────────────

def toi_str(s):
    try:
        m, sec = str(s).split(":")
        return int(m) * 60 + int(sec)
    except Exception:
        return 0


EVENT_NAMES = {505: "Goal", 506: "Shot on goal", 507: "Missed shot", 508: "Blocked shot"}


def build_game(game, gs_rows, shots, shifts, fetch_api=True):
    """One game's analysis JSON (same shape the old page computed per request)."""
    gid = str(game["id"])
    home, away = game["home"], game["away"]
    shifts = shifts.copy()
    team_id_to_tri = {ident(k): v for k, v in zip(shifts["team_id"], shifts["team_abbrev"])}

    meta = {}  # playerId -> {name, position, number, team}
    for pid, name, tri in shifts[["player_id", "player_name", "team_abbrev"]].drop_duplicates("player_id").itertuples(index=False):
        meta[ident(pid)] = {"name": name, "position": "", "team": tri}

    box = try_get_json(f"{API}/gamecenter/{gid}/boxscore", default=None) if fetch_api else None
    pbp = try_get_json(f"{API}/gamecenter/{gid}/play-by-play", default=None) if fetch_api else None

    bx = {}
    goalie_box = []
    if box:
        pgs = box.get("playerByGameStats") or {}
        for side, tri in (("homeTeam", home), ("awayTeam", away)):
            t = pgs.get(side) or {}
            for p in (t.get("forwards") or []) + (t.get("defense") or []):
                pid = ident(p.get("playerId"))
                bx[pid] = p
                m = meta.setdefault(pid, {"name": (p.get("name") or {}).get("default", pid), "position": "", "team": tri})
                m["position"] = p.get("position") or m["position"]
                m["number"] = str(p.get("sweaterNumber") or "") or None
                full = (p.get("name") or {}).get("default")
                if full and not m.get("name"):
                    m["name"] = full
            for g in t.get("goalies") or []:
                goalie_box.append((tri, g))

    # Situation timeline from PBP (for PP/PK TOI) + faceoffs.
    sit = []
    fo_w, fo_l = defaultdict(int), defaultdict(int)
    if pbp:
        plays = sorted({p["eventId"]: p for p in pbp.get("plays", [])}.values(), key=lambda p: p.get("sortOrder", 0))
        by_period = defaultdict(list)
        for p in plays:
            by_period[(p.get("periodDescriptor") or {}).get("number", 1)].append(p)
        for period, pl in by_period.items():
            for i, p in enumerate(pl):
                start = toi_str(p.get("timeInPeriod"))
                end = toi_str(pl[i + 1].get("timeInPeriod")) if i < len(pl) - 1 else 1200
                if end <= start:
                    continue
                sc = p.get("situationCode") or "1551"
                both = len(sc) == 4 and sc[0] == "1" and sc[3] == "1"
                try:
                    a_sk, h_sk = int(sc[1]), int(sc[2])
                except Exception:
                    a_sk, h_sk = 5, 5
                sit.append((period, start, end, h_sk, a_sk, both))
                if p.get("typeCode") == 502:
                    d = p.get("details") or {}
                    if d.get("winningPlayerId"):
                        fo_w[str(d["winningPlayerId"])] += 1
                    if d.get("losingPlayerId"):
                        fo_l[str(d["losingPlayerId"])] += 1

    # Shots
    g_shots = []
    for r in shots.itertuples(index=False):
        pid = ident(r.player_id)
        m = meta.get(pid, {})
        tri = team_id_to_tri.get(ident(r.team_id)) or m.get("team", "")
        period = int(num(r.period, 1))
        t = num(r.time_seconds)
        xg = num(getattr(r, "xG_flurry_adj", None), num(r.xG))
        g_shots.append({
            "eventId": int(num(r.event_id)),
            "period": period,
            "timeSeconds": int(t),
            "elapsedSeconds": int((period - 1) * 1200 + t),
            "teamTriCode": tri,
            "playerId": pid,
            "playerName": m.get("name", pid),
            "shotType": r.shot_type if isinstance(r.shot_type, str) else "shot",
            "x": int(num(r.x)),
            "y": int(num(r.y)),
            "distance": round(num(r.distance), 1),
            "angle": round(num(r.angle), 1),
            "strength": r.strength_state if isinstance(r.strength_state, str) else "All",
            "isGoal": int(num(r.is_goal)) == 1,
            "eventType": EVENT_NAMES.get(int(num(r.event_type)), "Shot attempt"),
            "xG": r3(xg),
        })
    g_shots.sort(key=lambda s: s["elapsedSeconds"])

    # Skaters: TOI from shifts; on-ice xG/goals from shift overlap.
    sh = [(ident(r.player_id), int(r.period), num(r.start_seconds), num(r.end_seconds), r.team_abbrev)
          for r in shifts.itertuples(index=False)]
    stats = {}
    for pid, period, s0, s1, tri in sh:
        m = meta.get(pid, {})
        st = stats.setdefault(pid, {
            "playerId": pid, "name": m.get("name", pid), "teamTriCode": tri, "position": m.get("position", ""),
            "number": m.get("number"), "toiSeconds": 0, "goals": 0, "shots": 0, "attempts": 0, "ixG": 0.0,
            "xGFor": 0.0, "xGAgainst": 0.0, "goalsFor": 0, "goalsAgainst": 0,
        })
        st["toiSeconds"] += max(0, s1 - s0)
    for s in g_shots:
        shooter = stats.get(s["playerId"])
        if shooter:
            shooter["attempts"] += 1
            if s["eventType"] in ("Goal", "Shot on goal"):
                shooter["shots"] += 1
            if s["isGoal"]:
                shooter["goals"] += 1
            shooter["ixG"] += s["xG"]
        for pid, period, s0, s1, tri in sh:
            if period != s["period"] or not (s0 <= s["timeSeconds"] <= s1):
                continue
            st = stats[pid]
            if tri == s["teamTriCode"]:
                st["xGFor"] += s["xG"]
                st["goalsFor"] += 1 if s["isGoal"] else 0
            else:
                st["xGAgainst"] += s["xG"]
                st["goalsAgainst"] += 1 if s["isGoal"] else 0

    # PP / PK TOI and boxscore extras
    pp_pk = defaultdict(lambda: [0.0, 0.0])
    if sit:
        for pid, period, s0, s1, tri in sh:
            is_home = tri == home
            for (p, a, b, h_sk, a_sk, both) in sit:
                if p != period or not both:
                    continue
                ov = min(s1, b) - max(s0, a)
                if ov <= 0:
                    continue
                mine, theirs = (h_sk, a_sk) if is_home else (a_sk, h_sk)
                if mine > theirs:
                    pp_pk[pid][0] += ov
                elif mine < theirs:
                    pp_pk[pid][1] += ov
    players = []
    goalie_ids = {ident((g or {}).get("playerId")) for _, g in goalie_box}
    goalie_names = {str(r.get("starting_goalie") or "") for r in gs_rows.values()} - {""}
    for pid, st in stats.items():
        b = bx.get(pid)
        if pid in goalie_ids or (b is None and st["name"] in goalie_names):
            continue
        if b is None and st["position"] == "G":
            continue
        if b is None and any(pid == ident((g or {}).get("playerId")) for _, g in goalie_box):
            continue
        if b:
            st["position"] = b.get("position") or st["position"]
            st["assists"] = int(b.get("assists") or 0)
            st["pim"] = int(b.get("pim") or 0)
            st["hits"] = int(b.get("hits") or 0)
            st["blockedShots"] = int(b.get("blockedShots") or 0)
        if pid in fo_w or pid in fo_l:
            st["faceoffWins"], st["faceoffLosses"] = fo_w.get(pid, 0), fo_l.get(pid, 0)
        if sit:
            st["ppToiSeconds"], st["pkToiSeconds"] = int(pp_pk[pid][0]), int(pp_pk[pid][1])
        for k in ("ixG", "xGFor", "xGAgainst"):
            st[k] = r3(st[k])
        st["toiSeconds"] = int(st["toiSeconds"])
        if not st.get("number"):
            st.pop("number", None)
        if st["toiSeconds"] > 0:
            players.append(st)
    players.sort(key=lambda p: -p["toiSeconds"])

    def team_summary(row, tri):
        return {
            "triCode": tri,
            "goals": int(num(row.get("goals_for"))),
            "shots": int(num(row.get("sog_for"))),
            "attempts": int(num(row.get("attempts_for"))),
            "xG": r3(row.get("xG_for")),
            "xG5v5": r3(row.get("xG_for_5v5")),
            "ppGoals": int(num(row.get("pp_goals"))),
            "ppOpps": int(num(row.get("pp_opportunities"))),
            "hits": int(num(row.get("hits_for"))),
        }

    def goalie_line(row, tri):
        name = row.get("starting_goalie") or ""
        en = num(row.get("emptynet_goalsagainst"))
        sa = max(0.0, num(row.get("sog_ag")) - en)
        ga = max(0.0, num(row.get("goals_ag")) - en)
        xga = num(row.get("xG_against"))
        toi = 0
        for t2, g in goalie_box:
            if t2 == tri and ((g.get("name") or {}).get("default", "").split(" ")[-1] in name):
                toi = toi_str(g.get("toi"))
        sv = (sa - ga) / sa if sa else 0.0
        xsv = (sa - xga) / sa if sa else 0.0
        return {
            "name": name, "teamTriCode": tri, "toiSeconds": toi or 3600, "shotsAgainst": int(sa),
            "fenwickAgainst": int(max(0.0, num(row.get("attempts_ag")) - num(row.get("en_attempts_against")))),
            "goalsAgainst": int(ga), "xGA": r3(xga), "gsax": r3(xga - ga), "savePct": r3(sv),
            "expectedSavePct": r3(xsv), "deltaSavePct": r3(sv - xsv),
        }

    h_row = gs_rows.get(home, {})
    a_row = gs_rows.get(away, {})
    max_s = max([3600] + [s["elapsedSeconds"] for s in g_shots])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "gameId": gid,
        "gameNumber": game["n"],
        "date": game["date"],
        "homeTriCode": home,
        "awayTriCode": away,
        "homeScore": game["home_score"],
        "awayScore": game["away_score"],
        "decision": game.get("decision"),
        "homeSummary": team_summary(h_row, home),
        "awaySummary": team_summary(a_row, away),
        "shots": g_shots,
        "players": players,
        "goalies": [goalie_line(h_row, home), goalie_line(a_row, away)],
        "maxGameSeconds": int(max_s),
    }


# ── Summary ──────────────────────────────────────────────────────────────────

def build(season_id, fetch_games=True, only_summary=False):
    start_year = int(season_id[:4])
    end_year = start_year + 1
    out_dir = os.path.join(PUBLIC_DATA_DIR, "playoffs", str(end_year))
    names, common_to_tri = load_team_names()

    bracket = try_get_json(f"{API}/playoff-bracket/{end_year}", default=None)
    if not bracket or not bracket.get("series"):
        print(f"[playoff_archive] no bracket for {end_year}; nothing to do")
        return None

    def csv(kind):
        path = os.path.join(PIPELINE_DIR, season.season_file(kind, start_year))
        return pd.read_csv(path) if os.path.exists(path) else pd.DataFrame()

    gamestats = csv("gamestats")
    shots_all = csv("shots")
    shifts_all = csv("shifts")
    if not gamestats.empty:
        gamestats["gid"] = gamestats["game_id"].astype(str)
    if not shots_all.empty:
        shots_all = shots_all[shots_all["game_id"].astype(str).str[4:6] == "03"]
        shots_all["gid"] = shots_all["game_id"].astype(str)
    if not shifts_all.empty:
        shifts_all = shifts_all[shifts_all["game_id"].astype(str).str[4:6] == "03"]
        shifts_all["gid"] = shifts_all["game_id"].astype(str)

    def gs_for(gid):
        rows = {}
        if gamestats.empty:
            return rows
        for _, r in gamestats[gamestats["gid"] == gid].iterrows():
            tri = common_to_tri.get(str(r["team"]).strip())
            if tri:
                rows[tri] = r.to_dict()
        return rows

    series_out = []
    participants = set()
    written = 0
    for s in sorted(bracket["series"], key=lambda x: (x.get("playoffRound", 0), x.get("seriesLetter", ""))):
        letter = s.get("seriesLetter")
        top = s.get("topSeedTeam") or {}
        bot = s.get("bottomSeedTeam") or {}
        if not letter or not top.get("abbrev") or not bot.get("abbrev"):
            continue  # a round that isn't set yet
        sched = try_get_json(f"{API}/schedule/playoff-series/{season_id}/{letter.lower()}", default={}) or {}
        st = sched.get("topSeedTeam") or {}
        sb = sched.get("bottomSeedTeam") or {}
        conf = (st.get("conference") or {}).get("abbrev")
        rnd = int(s.get("playoffRound") or sched.get("round") or 0)
        conference = None if rnd == 4 else ("East" if conf == "E" else "West" if conf == "W" else None)
        top_tri, bot_tri = top["abbrev"], bot["abbrev"]
        participants.update([top_tri, bot_tri])
        games = []
        totals = {t: {"goals": 0, "xg": 0.0, "sog": 0, "attempts": 0, "ppGoals": 0, "ppOpps": 0, "hits": 0}
                  for t in (top_tri, bot_tri)}
        for g in sched.get("games") or []:
            state = g.get("gameState")
            final = state in ("OFF", "FINAL")
            live = state in ("LIVE", "CRIT")
            if not final and not live and g.get("ifNecessary"):
                continue  # an "if necessary" game that will never be played
            home = (g.get("homeTeam") or {}).get("abbrev")
            away = (g.get("awayTeam") or {}).get("abbrev")
            outcome = (g.get("gameOutcome") or {}).get("lastPeriodType") or (g.get("periodDescriptor") or {}).get("periodType")
            game = {
                "id": g["id"],
                "n": g.get("gameNumber"),
                "date": et_date(g.get("startTimeUTC", ""), g.get("easternUTCOffset") or "-04:00"),
                "start_utc": g.get("startTimeUTC"),
                "home": home,
                "away": away,
                "home_score": (g.get("homeTeam") or {}).get("score") if (final or live) else None,
                "away_score": (g.get("awayTeam") or {}).get("score") if (final or live) else None,
                "decision": ("OT" if outcome == "OT" else "SO" if outcome == "SO" else "REG") if final else None,
                "state": "final" if final else "live" if live else "scheduled",
                "analysis": False,
            }
            if final:
                gid = str(g["id"])
                rows = gs_for(gid)
                for tri, row in rows.items():
                    if tri in totals:
                        t = totals[tri]
                        t["goals"] += int(num(row.get("goals_for")))
                        t["xg"] += num(row.get("xG_for"))
                        t["sog"] += int(num(row.get("sog_for")))
                        t["attempts"] += int(num(row.get("attempts_for")))
                        t["ppGoals"] += int(num(row.get("pp_goals")))
                        t["ppOpps"] += int(num(row.get("pp_opportunities")))
                        t["hits"] += int(num(row.get("hits_for")))
                g_shots = shots_all[shots_all["gid"] == gid] if not shots_all.empty else shots_all
                g_shifts = shifts_all[shifts_all["gid"] == gid] if not shifts_all.empty else shifts_all
                path = os.path.join(out_dir, f"{gid}.json")
                if len(g_shots) and len(g_shifts):
                    if not only_summary or not os.path.exists(path):
                        atomic_write_json(path, build_game(game, rows, g_shots, g_shifts, fetch_api=fetch_games))
                        written += 1
                    game["analysis"] = True
            games.append(game)
        games.sort(key=lambda x: x["n"] or 0)
        tw, bw = int(s.get("topSeedWins") or 0), int(s.get("bottomSeedWins") or 0)
        need = int(sched.get("neededToWin") or 4)
        winner = top_tri if tw >= need else bot_tri if bw >= need else None
        for t in totals.values():
            t["xg"] = r3(t["xg"])
        series_out.append({
            "letter": letter,
            "round": rnd,
            "roundLabel": ROUND_LABELS.get(rnd, s.get("seriesTitle")),
            "conference": conference,
            "top": {"tri": top_tri, "seed": seed_label(st or top, s.get("topSeedRankAbbrev"))},
            "bottom": {"tri": bot_tri, "seed": seed_label(sb or bot, s.get("bottomSeedRankAbbrev"))},
            "topWins": tw,
            "bottomWins": bw,
            "winner": winner,
            "status": "final" if winner else ("in_progress" if tw + bw > 0 else "scheduled"),
            "games": games,
            "totals": totals,
        })

    final = next((x for x in series_out if x["round"] == 4), None)
    champion = final["winner"] if final and final["winner"] else None
    runner_up = None
    if champion:
        runner_up = final["bottom"]["tri"] if final["top"]["tri"] == champion else final["top"]["tri"]

    # Regular-season head-to-head for every playoff pairing.
    h2h = {}
    if not gamestats.empty:
        reg = gamestats[(gamestats["gid"].str[4:6] == "02") & (gamestats["home_away"] == "Home")]
        for x in series_out:
            a, b = x["top"]["tri"], x["bottom"]["tri"]
            key = f"{a}_{b}"
            rows = []
            for _, r in reg.iterrows():
                ht = common_to_tri.get(str(r["team"]).strip())
                at = common_to_tri.get(str(r["opponent"]).strip())
                if {ht, at} != {a, b}:
                    continue
                res = str(r.get("result") or "")
                rows.append({
                    "date": str(r["game_date"]),
                    "home": ht,
                    "away": at,
                    "homeGoals": int(num(r["goals_for"])),
                    "awayGoals": int(num(r["goals_ag"])),
                    "decision": "SO" if "SO" in res else "OT" if "OT" in res else "REG",
                })
            h2h[key] = sorted(rows, key=lambda z: z["date"])

    # Playoff leaders from the per-game files.
    skaters = defaultdict(lambda: {"name": "", "team": "", "gp": 0, "g": 0, "a": 0, "ixg": 0.0})
    goalies = defaultdict(lambda: {"name": "", "team": "", "gp": 0, "gsax": 0.0, "sa": 0, "ga": 0})
    for x in series_out:
        for g in x["games"]:
            path = os.path.join(out_dir, f"{g['id']}.json")
            if not g["analysis"] or not os.path.exists(path):
                continue
            with open(path) as f:
                ga = json.load(f)
            for p in ga["players"]:
                s = skaters[p["playerId"]]
                s.update(name=p["name"], team=p["teamTriCode"])
                s["gp"] += 1
                s["g"] += p["goals"]
                s["a"] += p.get("assists", 0)
                s["ixg"] += p["ixG"]
            for gl in ga["goalies"]:
                if not gl["name"]:
                    continue
                s = goalies[(gl["teamTriCode"], gl["name"])]
                s.update(name=gl["name"], team=gl["teamTriCode"])
                s["gp"] += 1
                s["gsax"] += gl["gsax"]
                s["sa"] += gl["shotsAgainst"]
                s["ga"] += gl["goalsAgainst"]
    points = sorted(skaters.items(), key=lambda kv: (-(kv[1]["g"] + kv[1]["a"]), -kv[1]["g"], kv[1]["gp"]))[:5]
    goal_list = sorted(skaters.items(), key=lambda kv: (-kv[1]["g"], -kv[1]["ixg"]))[:5]
    goalie_list = sorted(goalies.values(), key=lambda v: -v["gsax"])[:5]
    leaders = {
        "points": [{"playerId": k, "name": v["name"], "team": v["team"], "gp": v["gp"], "g": v["g"], "a": v["a"], "pts": v["g"] + v["a"]} for k, v in points],
        "goals": [{"playerId": k, "name": v["name"], "team": v["team"], "gp": v["gp"], "g": v["g"], "ixg": r3(v["ixg"])} for k, v in goal_list],
        "goalies": [{"name": v["name"], "team": v["team"], "gp": v["gp"], "gsax": r3(v["gsax"]),
                     "svPct": r3((v["sa"] - v["ga"]) / v["sa"]) if v["sa"] else None} for v in goalie_list],
    }

    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "seasonId": season_id,
        "seasonLabel": f"{start_year}-{str(end_year)[2:]}",
        "year": end_year,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "complete" if champion else "in_progress",
        "champion": champion,
        "runnerUp": runner_up,
        "teams": {t: names.get(t, {"name": t, "short": t}) for t in sorted(participants)},
        "series": series_out,
        "h2h": h2h,
        "leaders": leaders,
        "sources": "NHL api-web (bracket, schedules, boxscores, play-by-play); Pony xG shot model (xG).",
    }
    atomic_write_json(os.path.join(out_dir, "summary.json"), summary)
    n_games = sum(len(x["games"]) for x in series_out)
    print(f"[playoff_archive] {season_id}: {len(series_out)} series, {n_games} games, "
          f"{written} game files written, champion={champion}")
    return summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--season", default=season.PREV_SEASON_ID, help="NHL season id, e.g. 20252026 (default: last season)")
    ap.add_argument("--no-api", action="store_true", help="skip per-game boxscore/play-by-play enrichment")
    ap.add_argument("--summary-only", action="store_true", help="only (re)write games whose file is missing")
    args = ap.parse_args(argv)
    if not (len(args.season) == 8 and args.season.isdigit()):
        ap.error("--season must look like 20252026")
    out = build(args.season, fetch_games=not args.no_api, only_summary=args.summary_only)
    return 0 if out else 1


if __name__ == "__main__":
    sys.exit(main())
