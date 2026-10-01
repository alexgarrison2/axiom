"""Raw payloads -> normalised per-game tables (DESIGN §2.3, §3.0).

``parse_game`` turns one game's PBP (+ shift charts, boxscore, right-rail) into:

  games     1 row: teams, finals, outcome type, coverage flags and per-game QA
  events    every play: clock, situationCode split into skaters/goalies per side,
            strength + empty-net from the acting team's view, raw and normalised
            coordinates (rink side inferred where homeTeamDefendingSide is
            missing), shot geometry, every player-id field, running score, and
            the on-ice skaters/goalies from shifts
  shifts    shift charts, typeCode 517 only, de-duplicated on
            (player, period, start, end)
  lineups   dressed players (boxscore ∪ rosterSpots) + scratches (right-rail),
            with starter flag, boxscore TOI and shift-chart TOI

situationCode is "{away goalie}{away skaters}{home skaters}{home goalie}".
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .onice import assign_on_ice
from .sides import attacks_right, infer_period_sides

SHOT_CODES = {505: "goal", 506: "shot-on-goal", 507: "missed-shot", 508: "blocked-shot"}
UNBLOCKED = {505, 506, 507}
GOAL = 505
NET_X = 89.0

PLAYER_FIELDS = {
    "shootingPlayerId": "shooter_raw_id", "scoringPlayerId": "scorer_id",
    "assist1PlayerId": "assist1_id", "assist2PlayerId": "assist2_id",
    "goalieInNetId": "goalie_in_net_id", "blockingPlayerId": "blocker_id",
    "hittingPlayerId": "hitter_id", "hitteePlayerId": "hittee_id",
    "winningPlayerId": "fo_winner_id", "losingPlayerId": "fo_loser_id",
    "playerId": "player_id", "committedByPlayerId": "pen_committed_by_id",
    "drawnByPlayerId": "pen_drawn_by_id", "servedByPlayerId": "pen_served_by_id",
}
INT_COLS = ["event_id", "sort_order", "period", "period_seconds", "game_seconds", "type_code",
            "event_team_id", "shooting_team_id", "shooter_id", "home_score", "away_score",
            "sit_away_g", "sit_away_sk", "sit_home_sk", "sit_home_g", "own_skaters", "opp_skaters",
            "pen_duration", "home_goalie_id", "away_goalie_id", "home_on_n", "away_on_n",
            "home_goalies_n", "away_goalies_n"] + list(PLAYER_FIELDS.values())


def mmss(s) -> int | None:
    if not s or not isinstance(s, str) or ":" not in s:
        return None
    try:
        m, sec = s.split(":")[:2]
        return int(m) * 60 + int(sec)
    except ValueError:
        return None


def split_situation(code):
    """'1551' -> (away_g, away_sk, home_sk, home_g); None if malformed."""
    if code is None:
        return None
    s = str(code).strip()
    if len(s) != 4 or not s.isdigit():
        return None
    return int(s[0]), int(s[1]), int(s[2]), int(s[3])


def _name(v):
    return v.get("default") if isinstance(v, dict) else v


def roster_map(pbp: dict, box: dict | None) -> dict[int, dict]:
    """player_id -> {team_id, position, sweater_number, first_name, last_name}."""
    out: dict[int, dict] = {}
    for r in pbp.get("rosterSpots") or []:
        pid = r.get("playerId")
        if pid is None:
            continue
        out[int(pid)] = {"team_id": r.get("teamId"), "position": r.get("positionCode"),
                         "sweater_number": r.get("sweaterNumber"),
                         "first_name": _name(r.get("firstName")) or "", "last_name": _name(r.get("lastName")) or ""}
    if box:
        stats = box.get("playerByGameStats") or {}
        for side in ("homeTeam", "awayTeam"):
            tid = (box.get(side) or {}).get("id")
            for group in ("forwards", "defense", "goalies"):
                for p in (stats.get(side) or {}).get(group) or []:
                    pid = p.get("playerId")
                    if pid is None or int(pid) in out:
                        continue
                    nm = _name(p.get("name")) or ""
                    out[int(pid)] = {"team_id": tid, "position": p.get("position"),
                                     "sweater_number": p.get("sweaterNumber"), "first_name": "",
                                     "last_name": nm.split(". ", 1)[-1] if nm else ""}
    return out


# --------------------------------------------------------------------- shifts

def merge_overlaps(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Merge a player's overlapping shifts within a period (the feed sometimes carries
    stale partial copies, e.g. 310-313 + 310-342 + 331-342), so no player is ever
    counted twice on the ice.  Touching shifts (end == next start) stay separate."""
    if df.empty:
        return df, 0
    df = df.sort_values(["player_id", "period", "start_s", "end_s"], kind="stable").reset_index(drop=True)
    pid, per = df["player_id"].to_numpy(), df["period"].to_numpy()
    st, en = df["start_s"].to_numpy(), df["end_s"].to_numpy()
    keep = np.ones(len(df), dtype=bool)
    new_end = en.copy()
    cur = 0
    for i in range(1, len(df)):
        if pid[i] == pid[cur] and per[i] == per[cur] and st[i] < new_end[cur]:
            new_end[cur] = max(new_end[cur], en[i])
            keep[i] = False
        else:
            cur = i
    merged = int((~keep).sum())
    if merged:
        df = df.assign(end_s=new_end)[keep].reset_index(drop=True)
    return df, merged


def parse_shifts(payload: dict | None, game_id: int, season: str, roster: dict,
                 team_ids=None) -> tuple[pd.DataFrame, dict]:
    """``team_ids``: the game's two team ids.  Rows of any other team are dropped and
    counted (the feed occasionally mixes in another game's shifts: 2025020565, NJD-BUF,
    also carries ~670 VGK/SJS rows)."""
    cols = ["game_id", "season", "player_id", "team_id", "period", "start_s", "end_s", "duration_s",
            "game_start_s", "game_end_s", "shift_number", "is_goalie"]
    qa = {"n_shift_rows_raw": 0, "n_shift_non517": 0, "n_shift_dups": 0, "n_shift_bad_times": 0,
          "n_shift_overlaps_merged": 0, "n_shift_foreign_team": 0}
    rows = (payload or {}).get("data") or []
    qa["n_shift_rows_raw"] = len(rows)
    teams = {int(t) for t in (team_ids or ()) if t is not None}
    recs = []
    for r in rows:
        if r.get("typeCode") not in (None, 517):
            qa["n_shift_non517"] += 1
            continue
        if len(teams) == 2 and r.get("teamId") is not None and int(r["teamId"]) not in teams:
            qa["n_shift_foreign_team"] += 1
            continue
        st, en = mmss(r.get("startTime")), mmss(r.get("endTime"))
        pid, per = r.get("playerId"), r.get("period")
        if st is None or en is None or pid is None or per is None or en <= st:
            qa["n_shift_bad_times"] += 1
            continue
        recs.append((int(pid), r.get("teamId"), int(per), st, en, r.get("shiftNumber")))
    df = pd.DataFrame(recs, columns=["player_id", "team_id", "period", "start_s", "end_s", "shift_number"])
    if df.empty:
        return pd.DataFrame(columns=cols), qa
    n0 = len(df)
    df = df.drop_duplicates(subset=["player_id", "period", "start_s", "end_s"], keep="first")
    qa["n_shift_dups"] = n0 - len(df)
    df, qa["n_shift_overlaps_merged"] = merge_overlaps(df)
    df["game_id"] = game_id
    df["season"] = season
    df["duration_s"] = df["end_s"] - df["start_s"]
    off = (df["period"] - 1) * 1200
    df["game_start_s"] = off + df["start_s"]
    df["game_end_s"] = off + df["end_s"]
    df["is_goalie"] = df["player_id"].map(lambda p: (roster.get(int(p)) or {}).get("position") == "G")
    df = df.sort_values(["period", "start_s", "team_id", "player_id"], kind="stable").reset_index(drop=True)
    return df[cols], qa


# --------------------------------------------------------------------- events

def _team_meta(pbp: dict, box: dict | None):
    h, a = pbp.get("homeTeam") or {}, pbp.get("awayTeam") or {}
    if box:
        h = {**(box.get("homeTeam") or {}), **h}
        a = {**(box.get("awayTeam") or {}), **a}
    return h, a


def parse_events(pbp: dict, game_id: int, season: str, roster: dict, home_id, away_id) -> pd.DataFrame:
    plays = sorted(pbp.get("plays") or [], key=lambda p: (p.get("sortOrder") or 0, p.get("eventId") or 0))
    recs = []
    cur_h, cur_a = 0, 0
    for p in plays:
        d = p.get("details") or {}
        pdsc = p.get("periodDescriptor") or {}
        period = pdsc.get("number")
        ptype = pdsc.get("periodType")
        tc = p.get("typeCode")
        psec = mmss(p.get("timeInPeriod"))
        sit = split_situation(p.get("situationCode"))
        owner = d.get("eventOwnerTeamId")
        rec = {
            "game_id": game_id, "season": season, "event_id": p.get("eventId"),
            "sort_order": p.get("sortOrder"), "period": period, "period_type": ptype,
            "period_seconds": psec,
            "game_seconds": (period - 1) * 1200 + psec if period and psec is not None else None,
            "type_code": tc, "type_desc": p.get("typeDescKey"),
            "situation_code": p.get("situationCode"),
            "sit_away_g": sit[0] if sit else None, "sit_away_sk": sit[1] if sit else None,
            "sit_home_sk": sit[2] if sit else None, "sit_home_g": sit[3] if sit else None,
            "event_team_id": owner,
            "x": d.get("xCoord"), "y": d.get("yCoord"), "zone_code": d.get("zoneCode"),
            "home_def_side_raw": p.get("homeTeamDefendingSide"),
            "shot_type": d.get("shotType"), "reason": d.get("reason"),
            "secondary_reason": d.get("secondaryReason"),
            "pen_type_code": d.get("typeCode"), "pen_desc_key": d.get("descKey"),
            "pen_duration": d.get("duration"),
            "home_score": cur_h, "away_score": cur_a,
        }
        for src, dst in PLAYER_FIELDS.items():
            rec[dst] = d.get(src)
        if tc == GOAL and ptype != "SO":
            hs, as_ = d.get("homeScore"), d.get("awayScore")
            if hs is not None and as_ is not None:
                cur_h, cur_a = int(hs), int(as_)
            elif owner == home_id:
                cur_h += 1
            elif owner == away_id:
                cur_a += 1
        recs.append(rec)
    ev = pd.DataFrame(recs)
    if ev.empty:
        return ev

    # Shooting team: from the shooter's roster team (blocked-shot ownership has
    # changed over the years), else from the event owner.
    is_shot = ev["type_code"].isin(list(SHOT_CODES))
    shooter = ev["scorer_id"].where(ev["type_code"] == GOAL, ev["shooter_raw_id"])
    shooter = shooter.where(shooter.notna(), ev["shooter_raw_id"])
    ev["shooter_id"] = shooter.where(is_shot)

    def _shoot_team(row):
        if not row["_is_shot"]:
            return None
        pid = row["shooter_id"]
        if pid is not None and not (isinstance(pid, float) and math.isnan(pid)):
            t = (roster.get(int(pid)) or {}).get("team_id")
            if t is not None:
                return t
        own = row["event_team_id"]
        if row["type_code"] == 508:
            bid = row["blocker_id"]
            bteam = (roster.get(int(bid)) or {}).get("team_id") if pd.notna(bid) else None
            if bteam is not None and own == bteam:
                return away_id if own == home_id else home_id
        return own
    ev["_is_shot"] = is_shot
    ev["shooting_team_id"] = ev.apply(_shoot_team, axis=1)
    ev = ev.drop(columns="_is_shot")

    acting = ev["shooting_team_id"].where(is_shot, ev["event_team_id"])
    ev["acting_team_id"] = acting
    ev["event_team_is_home"] = [None if pd.isna(t) else bool(t == home_id) for t in ev["event_team_id"]]
    ev["acting_is_home"] = [None if pd.isna(t) else bool(t == home_id) for t in acting]

    # Strength and empty net from the acting team's view.
    own_sk, opp_sk, own_g, opp_g = [], [], [], []
    for ih, hs, hg, as_, ag in zip(ev["acting_is_home"], ev["sit_home_sk"], ev["sit_home_g"],
                                   ev["sit_away_sk"], ev["sit_away_g"]):
        if ih is None or pd.isna(hs):
            own_sk.append(None); opp_sk.append(None); own_g.append(None); opp_g.append(None)  # noqa: E702
        elif ih:
            own_sk.append(hs); opp_sk.append(as_); own_g.append(hg); opp_g.append(ag)  # noqa: E702
        else:
            own_sk.append(as_); opp_sk.append(hs); own_g.append(ag); opp_g.append(hg)  # noqa: E702
    ev["own_skaters"], ev["opp_skaters"] = own_sk, opp_sk
    ev["strength"] = [f"{int(a)}v{int(b)}" if a is not None and b is not None else None
                      for a, b in zip(own_sk, opp_sk)]
    ev["empty_net_against"] = [None if g is None else bool(g == 0) for g in opp_g]
    ev["own_goalie_pulled"] = [None if g is None else bool(g == 0) for g in own_g]
    ev["is_shootout"] = ev["period_type"].eq("SO")
    ev["is_penalty_shot"] = [bool(a is not None and b is not None and a == 1 and b == 0)
                             for a, b in zip(own_sk, opp_sk)]
    return ev


def apply_sides(ev: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    sides = infer_period_sides(ev)
    ev = ev.drop(columns=[c for c in ("home_def_side", "side_source") if c in ev.columns])
    ev = ev.merge(sides[["period", "home_def_side", "side_source", "home_def_side_vote"]],
                  on="period", how="left")
    ar = attacks_right(ev["acting_is_home"], ev["home_def_side"])
    x = pd.to_numeric(ev["x"], errors="coerce")
    y = pd.to_numeric(ev["y"], errors="coerce")
    sign = pd.Series([np.nan if a is None else (1.0 if a else -1.0) for a in ar], index=ev.index)
    ev["x_norm"] = x * sign
    ev["y_norm"] = y * sign
    home_right = ev["home_def_side"].map({"left": 1.0, "right": -1.0})
    ev["x_home"] = x * home_right
    ev["y_home"] = y * home_right
    is_shot = ev["type_code"].isin(list(SHOT_CODES))
    dx = NET_X - ev["x_norm"]
    ev["shot_distance"] = np.sqrt(dx ** 2 + ev["y_norm"] ** 2).where(is_shot)
    ev["shot_angle"] = np.degrees(np.arctan2(ev["y_norm"].abs(), dx)).where(is_shot)
    return ev, sides


# ---------------------------------------------------------------------- lineups

def parse_lineups(pbp: dict, box: dict | None, rr: dict | None, roster: dict, game_id: int, season: str,
                  home, away, shifts: pd.DataFrame) -> pd.DataFrame:
    rows: dict[int, dict] = {}
    teams = {home.get("id"): (True, home.get("abbrev")), away.get("id"): (False, away.get("abbrev"))}
    if box:
        stats = box.get("playerByGameStats") or {}
        for side, meta in (("homeTeam", home), ("awayTeam", away)):
            for group in ("forwards", "defense", "goalies"):
                for p in (stats.get(side) or {}).get(group) or []:
                    pid = int(p["playerId"])
                    info = roster.get(pid) or {}
                    rows[pid] = {
                        "player_id": pid, "team_id": meta.get("id"), "status": "dressed",
                        "position": p.get("position") or info.get("position"),
                        "sweater_number": p.get("sweaterNumber"),
                        "first_name": info.get("first_name", ""), "last_name": info.get("last_name", ""),
                        "starter": bool(p.get("starter")) if group == "goalies" else None,
                        "toi_s": mmss(p.get("toi")), "source": "boxscore",
                    }
    for pid, info in roster.items():
        if pid not in rows and info.get("team_id") in teams:
            rows[pid] = {"player_id": pid, "team_id": info.get("team_id"), "status": "dressed",
                         "position": info.get("position"), "sweater_number": info.get("sweater_number"),
                         "first_name": info.get("first_name", ""), "last_name": info.get("last_name", ""),
                         "starter": None, "toi_s": None, "source": "rosterSpots"}
    gi = (rr or {}).get("gameInfo") or {}
    for side, meta in (("homeTeam", home), ("awayTeam", away)):
        for s in (gi.get(side) or {}).get("scratches") or []:
            pid = s.get("id")
            if pid is None or int(pid) in rows:
                continue
            rows[int(pid)] = {"player_id": int(pid), "team_id": meta.get("id"), "status": "scratched",
                              "position": None, "sweater_number": None,
                              "first_name": _name(s.get("firstName")) or "",
                              "last_name": _name(s.get("lastName")) or "",
                              "starter": None, "toi_s": None, "source": "rightrail"}
    df = pd.DataFrame(list(rows.values()))
    if df.empty:
        return df
    df["game_id"] = game_id
    df["season"] = season
    df["is_home"] = df["team_id"].map(lambda t: teams.get(t, (None, None))[0])
    df["team_abbrev"] = df["team_id"].map(lambda t: teams.get(t, (None, None))[1])
    df["is_goalie"] = df["position"].eq("G")
    if shifts is not None and not shifts.empty:
        agg = shifts.groupby("player_id").agg(n_shifts=("start_s", "size"), shift_toi_s=("duration_s", "sum"))
        df = df.merge(agg, left_on="player_id", right_index=True, how="left")
    else:
        df["n_shifts"] = np.nan
        df["shift_toi_s"] = np.nan
    df["n_shifts"] = df["n_shifts"].fillna(0).astype(int)
    df["shift_toi_s"] = df["shift_toi_s"].fillna(0).astype(int)
    cols = ["game_id", "season", "team_id", "team_abbrev", "is_home", "player_id", "first_name", "last_name",
            "sweater_number", "position", "is_goalie", "status", "starter", "toi_s", "n_shifts",
            "shift_toi_s", "source"]
    return df[cols].sort_values(["is_home", "status", "player_id"], ascending=[False, True, True]).reset_index(drop=True)


# ------------------------------------------------------------------------ game

def parse_game(pbp: dict, shifts_payload: dict | None = None, box: dict | None = None,
               rr: dict | None = None, *, season: str | None = None) -> dict[str, pd.DataFrame]:
    game_id = int(pbp["id"])
    season = str(season or pbp.get("season"))
    home, away = _team_meta(pbp, box)
    home_id, away_id = home.get("id"), away.get("id")
    roster = roster_map(pbp, box)

    shifts, sqa = parse_shifts(shifts_payload, game_id, season, roster, (home_id, away_id))
    ev = parse_events(pbp, game_id, season, roster, home_id, away_id)
    sides = pd.DataFrame()
    if not ev.empty:
        ev, sides = apply_sides(ev)
        onice = assign_on_ice(ev, shifts.rename(columns={}), home_id)
        ev = pd.concat([ev, onice], axis=1)
        for c in INT_COLS:
            if c in ev.columns:
                ev[c] = pd.to_numeric(ev[c], errors="coerce").astype("Int64")
    lineups = parse_lineups(pbp, box, rr, roster, game_id, season, home, away, shifts)

    outcome = (pbp.get("gameOutcome") or (box or {}).get("gameOutcome") or {})
    nonso_goals = ev[(ev["type_code"] == GOAL) & ~ev["is_shootout"]] if not ev.empty else ev
    shots = ev[ev["type_code"].isin(list(SHOT_CODES)) & ~ev["is_shootout"]] if not ev.empty else ev
    side_src = sorted(set(sides["side_source"])) if len(sides) else []
    game = {
        "game_id": game_id, "season": season, "game_type": pbp.get("gameType"),
        "game_date": pbp.get("gameDate"), "start_time_utc": pbp.get("startTimeUTC"),
        "venue": _name(pbp.get("venue")),
        "home_team_id": home_id, "home_abbrev": home.get("abbrev"),
        "away_team_id": away_id, "away_abbrev": away.get("abbrev"),
        "home_score": home.get("score"), "away_score": away.get("score"),
        "last_period_type": outcome.get("lastPeriodType"),
        "n_periods": int(ev["period"].max()) if not ev.empty else None,
        "has_shifts": not shifts.empty, "has_boxscore": box is not None, "has_rightrail": rr is not None,
        "n_events": len(ev), "n_shots": len(shots),
        "home_goals_pbp": int((nonso_goals["event_team_id"] == home_id).sum()) if len(nonso_goals) else 0,
        "away_goals_pbp": int((nonso_goals["event_team_id"] == away_id).sum()) if len(nonso_goals) else 0,
        "side_source": "+".join(side_src),
        "n_scratches": int((lineups["status"] == "scratched").sum()) if len(lineups) else 0,
        "n_dressed": int((lineups["status"] == "dressed").sum()) if len(lineups) else 0,
        **sqa, "n_shifts": len(shifts),
    }
    return {"games": pd.DataFrame([game]), "events": ev, "shifts": shifts, "lineups": lineups}


SHOT_COLUMNS = [
    "game_id", "season", "event_id", "sort_order", "period", "period_type", "period_seconds", "game_seconds",
    "type_code", "type_desc", "is_goal", "is_unblocked", "shooting_team_id", "acting_is_home", "shooter_id",
    "goalie_in_net_id", "blocker_id", "assist1_id", "assist2_id", "shot_type", "x", "y", "x_norm", "y_norm",
    "shot_distance", "shot_angle", "zone_code", "situation_code", "strength", "own_skaters", "opp_skaters",
    "empty_net_against", "own_goalie_pulled", "is_penalty_shot", "home_score", "away_score",
    "home_def_side", "side_source", "home_skaters", "away_skaters", "home_goalie_id", "away_goalie_id",
    "home_on_n", "away_on_n", "home_goalies_n", "away_goalies_n", "onice_rule",
]


def shots_table(events: pd.DataFrame) -> pd.DataFrame:
    """Shot attempts (505-508) outside the shootout, with shot-oriented columns."""
    if events.empty:
        return pd.DataFrame(columns=SHOT_COLUMNS)
    s = events[events["type_code"].isin(list(SHOT_CODES)) & ~events["is_shootout"]].copy()
    s["is_goal"] = s["type_code"].eq(GOAL)
    s["is_unblocked"] = s["type_code"].isin(list(UNBLOCKED))
    return s[SHOT_COLUMNS].reset_index(drop=True)
