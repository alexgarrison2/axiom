"""Lake ``events`` -> one row per unblocked shot with the xG v2 features (DESIGN §3.1).

Input is the lake ``events`` table (``bu.lake.parse.parse_events`` + ``apply_sides``)
for whole games: every play in order, with the acting team, ``situationCode``
split into skaters/goalies, the running score before the event and the
coordinates in the home-attacks-+x frame (``x_home``/``y_home``).  The same
function serves training (lake partitions) and live scoring (a PBP payload
parsed with ``bu.lake.parse.parse_game``), so train and serve share one code
path.

Unit: unblocked attempts (505 goal, 506 shot on goal, 507 missed shot) outside
the shootout.  Penalty shots are flagged (``strength_class == "PS"``) and get a
constant rate from the training window.

Frames: ``x_s``/``y_s`` are in the shooting team's attacking frame (net at
(89, 0)); facing that net, +y is the shooter's left.  The previous event's
coordinates are converted into the *current shooter's* frame, so a rebound off
the same team's shot and a turnover by the opponent are comparable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

NET_X = 89.0
BLUE_LINE_X = 25.0
UNBLOCKED = (505, 506, 507)
SHOT_ATTEMPTS = (505, 506, 507, 508)

SHOT_TYPES = ["wrist", "snap", "slap", "backhand", "tip-in", "deflected", "wrap-around", "poke", "bat",
              "between-legs", "cradle"]
PREV_TYPES = ["faceoff", "shot-on-goal", "missed-shot", "blocked-shot", "goal", "hit", "giveaway", "takeaway",
              "stoppage", "penalty", "delayed-penalty", "period-start", "failed-shot-attempt"]
# Calibration / reporting classes (shooting team's view).
STRENGTH_CLASSES = ["5v5", "PP", "SH", "4v4", "3v3", "EA", "EN", "PS"]

FEATURES = [
    # geometry
    "distance", "angle", "x_s", "y_s", "abs_y", "behind_net", "dist_rink",
    # shot + shooter
    "shot_type_code", "hand_code", "off_wing",
    # strength / goalie state
    "own_skaters", "opp_skaters", "skater_diff", "own_goalie_pulled",
    # previous event
    "prev_type_code", "prev_same_team", "dt_prev", "prev_x_s", "prev_y_s", "dist_prev", "speed_prev",
    "angle_change", "angle_speed", "is_rebound", "is_rush",
    # clocks and game state
    "secs_since_faceoff", "secs_since_strength_change", "score_diff", "period", "period_seconds",
    "game_seconds", "is_home", "is_playoff",
]


def _code(series: pd.Series, levels: list[str]) -> pd.Series:
    m = {v: i for i, v in enumerate(levels)}
    return series.map(m).astype("float64")


def strength_class(own, opp, en_against, own_pulled, penalty_shot) -> np.ndarray:
    own = pd.to_numeric(pd.Series(own), errors="coerce").to_numpy(dtype="float64")
    opp = pd.to_numeric(pd.Series(opp), errors="coerce").to_numpy(dtype="float64")
    en = pd.Series(en_against).fillna(False).astype(bool).to_numpy()
    pulled = pd.Series(own_pulled).fillna(False).astype(bool).to_numpy()
    ps = pd.Series(penalty_shot).fillna(False).astype(bool).to_numpy()
    out = np.full(len(own), "5v5", dtype=object)
    eq = own == opp
    out[eq & (own == 4)] = "4v4"
    out[eq & (own == 3)] = "3v3"
    out[own > opp] = "PP"
    out[own < opp] = "SH"
    out[pulled & ~en] = "EA"     # extra attacker: own goalie pulled, opposing goalie in net
    out[en] = "EN"
    out[ps] = "PS"
    return out


def _signed_angle(x_s, y_s):
    """Angle (deg) of the shot location seen from the net; signed by side (+ = shooter's left)."""
    return np.degrees(np.arctan2(y_s, NET_X - x_s))


def shot_features(events: pd.DataFrame, games: pd.DataFrame | None = None,
                  hand: dict | None = None, rink=None) -> pd.DataFrame:
    """Unblocked shots of ``events`` with every v2 feature.

    ``games`` (optional) supplies ``game_type`` and ``venue``; without it the
    game type is read from the game id.  ``hand`` maps shooter id -> "L"/"R".
    ``rink`` is a fitted ``bu.xg.rink.RinkAdjuster`` (or None: no adjustment).
    """
    if events is None or events.empty:
        return pd.DataFrame(columns=["game_id", "event_id", "season", "is_goal", "strength_class"] + FEATURES)
    ev = events.sort_values(["game_id", "sort_order", "event_id"], kind="stable").reset_index(drop=True)
    tc = pd.to_numeric(ev["type_code"], errors="coerce")
    gid = ev["game_id"].astype("int64")
    period = pd.to_numeric(ev["period"], errors="coerce")
    gsec = pd.to_numeric(ev["game_seconds"], errors="coerce").astype("float64")
    acting_home = ev["acting_is_home"].astype("boolean")
    acting_team = pd.to_numeric(ev.get("acting_team_id"), errors="coerce")
    x_home = pd.to_numeric(ev["x_home"], errors="coerce")
    y_home = pd.to_numeric(ev["y_home"], errors="coerce")
    is_so = ev["is_shootout"].fillna(False).astype(bool) if "is_shootout" in ev else pd.Series(False, index=ev.index)

    # Previous event within the same game and period (any type, shootout excluded).
    same_seq = (gid == gid.shift(1)) & (period == period.shift(1))
    prev_type = ev["type_desc"].shift(1).where(same_seq)
    prev_team = acting_team.shift(1).where(same_seq)
    prev_gsec = gsec.shift(1).where(same_seq)
    prev_xh = x_home.shift(1).where(same_seq)
    prev_yh = y_home.shift(1).where(same_seq)
    prev_zone = ev["zone_code"].shift(1).where(same_seq)
    prev_acting_home = acting_home.shift(1).where(same_seq)

    # Clocks: last faceoff, last change of situationCode (strength/goalie state).
    fo_t = gsec.where(ev["type_desc"].eq("faceoff"))
    fo_t = fo_t.groupby(gid).ffill()
    sit = ev["situation_code"].astype("string")
    changed = (sit != sit.groupby(gid).shift(1)) | (gid != gid.shift(1))
    sc_t = gsec.where(changed).groupby(gid).ffill()

    keep = tc.isin(UNBLOCKED) & ~is_so
    s = ev.loc[keep, ["game_id", "event_id", "season", "period", "period_seconds", "game_seconds", "type_code",
                      "shot_type", "shooter_id", "shooting_team_id", "own_skaters", "opp_skaters",
                      "empty_net_against", "own_goalie_pulled", "is_penalty_shot", "home_score", "away_score",
                      "goalie_in_net_id"]].copy()
    idx = s.index
    shooter_home = acting_home.loc[idx]
    sign = np.where(shooter_home.fillna(True).to_numpy(dtype=bool), 1.0, -1.0)
    sign = np.where(shooter_home.isna().to_numpy(), np.nan, sign)
    x_s = x_home.loc[idx].to_numpy() * sign
    y_s = y_home.loc[idx].to_numpy() * sign
    s["is_goal"] = (tc.loc[idx] == 505).astype("int8").to_numpy()
    s["x_s"], s["y_s"] = x_s, y_s
    dx = NET_X - x_s
    s["distance"] = np.sqrt(dx ** 2 + y_s ** 2)
    s["angle"] = np.degrees(np.arctan2(np.abs(y_s), dx))
    s["abs_y"] = np.abs(y_s)
    s["behind_net"] = (x_s > NET_X).astype("float64")
    s.loc[np.isnan(x_s), "behind_net"] = np.nan

    s["shot_type_code"] = _code(s["shot_type"], SHOT_TYPES)
    hand = hand or {}
    h = pd.to_numeric(s["shooter_id"], errors="coerce").map(lambda p: hand.get(int(p)) if pd.notna(p) else None)
    s["hand_code"] = h.map({"L": 0.0, "R": 1.0}).astype("float64")
    off = np.where(h.eq("L"), (y_s < 0).astype(float), np.where(h.eq("R"), (y_s > 0).astype(float), np.nan))
    off[np.isnan(y_s)] = np.nan
    s["off_wing"] = off

    own = pd.to_numeric(s["own_skaters"], errors="coerce").astype("float64")
    opp = pd.to_numeric(s["opp_skaters"], errors="coerce").astype("float64")
    s["own_skaters"], s["opp_skaters"] = own, opp
    s["skater_diff"] = own - opp
    s["own_goalie_pulled"] = s["own_goalie_pulled"].astype("boolean").astype("float64")
    s["strength_class"] = strength_class(own, opp, s["empty_net_against"].astype("boolean"),
                                         s["own_goalie_pulled"].fillna(0) > 0, s["is_penalty_shot"].astype("boolean"))
    s["strength"] = [f"{int(a)}v{int(b)}" if a == a and b == b else None for a, b in zip(own, opp)]

    # previous event, in the current shooter's frame
    pt = prev_type.loc[idx]
    s["prev_type_code"] = _code(pt, PREV_TYPES)
    pteam = prev_team.loc[idx].to_numpy(dtype="float64")
    steam = pd.to_numeric(s["shooting_team_id"], errors="coerce").to_numpy(dtype="float64")
    same = np.where(np.isnan(pteam) | np.isnan(steam), np.nan, (pteam == steam).astype(float))
    s["prev_same_team"] = same
    dt = (gsec.loc[idx] - prev_gsec.loc[idx]).to_numpy(dtype="float64")
    dt = np.where(dt < 0, 0.0, dt)
    s["dt_prev"] = dt
    px = prev_xh.loc[idx].to_numpy(dtype="float64") * sign
    py = prev_yh.loc[idx].to_numpy(dtype="float64") * sign
    s["prev_x_s"], s["prev_y_s"] = px, py
    dist_prev = np.sqrt((x_s - px) ** 2 + (y_s - py) ** 2)
    s["dist_prev"] = dist_prev
    s["speed_prev"] = dist_prev / np.maximum(dt, 1.0)
    ang_now = _signed_angle(x_s, y_s)
    ang_prev = _signed_angle(px, py)
    prev_is_shot = pt.isin(["shot-on-goal", "missed-shot", "blocked-shot", "goal"]).to_numpy()
    ach = np.abs(ang_now - ang_prev)
    ach = np.where(ach > 180.0, 360.0 - ach, ach)   # wrap across the line behind the net
    ach = np.where(prev_is_shot, ach, 0.0)
    ach[prev_is_shot & (np.isnan(ang_now) | np.isnan(ang_prev))] = np.nan
    s["angle_change"] = ach
    s["angle_speed"] = ach / np.maximum(dt, 1.0)
    reb = prev_is_shot & (same == 1.0) & (dt <= 3.0)
    s["is_rebound"] = reb.astype("float64")
    # rush: previous event outside the offensive zone (in the shooter's frame) within 4 s
    pz = prev_zone.loc[idx]
    pah = prev_acting_home.loc[idx]
    flip = (pah.astype("boolean") != shooter_home.astype("boolean")).fillna(False).to_numpy(dtype=bool)
    zone_s = np.where(flip, pz.map({"O": "D", "D": "O", "N": "N"}), pz)
    outside = np.where(np.isnan(px), pd.Series(zone_s).isin(["N", "D"]).to_numpy(), px < BLUE_LINE_X)
    s["is_rush"] = ((dt <= 4.0) & outside & ~reb).astype("float64")

    t = gsec.loc[idx].to_numpy(dtype="float64")
    s["secs_since_faceoff"] = t - fo_t.loc[idx].to_numpy(dtype="float64")
    s["secs_since_strength_change"] = t - sc_t.loc[idx].to_numpy(dtype="float64")
    hs = pd.to_numeric(s["home_score"], errors="coerce").to_numpy(dtype="float64")
    as_ = pd.to_numeric(s["away_score"], errors="coerce").to_numpy(dtype="float64")
    diff = np.where(shooter_home.fillna(True).to_numpy(dtype=bool), hs - as_, as_ - hs)
    s["score_diff"] = np.clip(diff, -3, 3)
    s["period_raw"] = pd.to_numeric(s["period"], errors="coerce")
    s["game_seconds_raw"] = t
    s["period"] = np.minimum(s["period_raw"].astype("float64"), 4.0)
    s["period_seconds"] = pd.to_numeric(s["period_seconds"], errors="coerce").astype("float64")
    s["game_seconds"] = np.minimum(t, 3900.0)
    s["is_home"] = shooter_home.astype("float64").to_numpy()

    gtype = None
    if games is not None and len(games) and "game_type" in games.columns:
        gtype = s["game_id"].map(games.drop_duplicates("game_id").set_index("game_id")["game_type"])
    if gtype is None or gtype.isna().all():
        gtype = s["game_id"].astype(str).str[4:6].astype(int)
    s["game_type"] = pd.to_numeric(gtype, errors="coerce")
    s["is_playoff"] = (s["game_type"] == 3).astype("float64")
    if games is not None and len(games) and "venue" in games.columns:
        g = games.drop_duplicates("game_id").set_index("game_id")
        s["venue"] = s["game_id"].map(g["venue"])
        s["home_team_id"] = s["game_id"].map(g["home_team_id"]) if "home_team_id" in g else np.nan
        s["game_date"] = s["game_id"].map(g["game_date"]) if "game_date" in g else None
    else:
        s["venue"] = None
        s["home_team_id"] = np.nan
        s["game_date"] = None
    s["dist_rink"] = rink.adjust(s) if rink is not None else s["distance"]
    s["season"] = s["season"].astype(str)
    return s.reset_index(drop=True)


def flurry_adjust(df: pd.DataFrame, xg_col: str = "xg", gap: float = 3.0) -> pd.Series:
    """``xg_flurry = xg * prod(1 - xg_prev)`` over the same team's earlier shots in a
    sequence with gaps <= ``gap`` seconds (DESIGN §3.1; the RAPM target)."""
    d = df[["game_id", "shooting_team_id", "game_seconds", xg_col]].copy()
    d["_o"] = np.arange(len(d))
    d = d.sort_values(["game_id", "shooting_team_id", "game_seconds", "_o"], kind="stable")
    out = np.empty(len(d))
    g = d["game_id"].to_numpy()
    tm = d["shooting_team_id"].to_numpy()
    t = d["game_seconds"].to_numpy(dtype="float64")
    x = d[xg_col].to_numpy(dtype="float64")
    surv = 1.0
    for i in range(len(d)):
        if i == 0 or g[i] != g[i - 1] or tm[i] != tm[i - 1] or not (t[i] - t[i - 1] <= gap):
            surv = 1.0
        out[i] = x[i] * surv
        surv *= (1.0 - x[i])
    res = pd.Series(out, index=d["_o"].to_numpy()).sort_index()
    return pd.Series(res.to_numpy(), index=df.index)
