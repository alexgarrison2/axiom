"""Lake shifts + events -> stints (DESIGN §3.2 design matrix input, §3.0 boundary fixes).

A stint is a maximal interval of one period in which nobody changes and no faceoff or goal
happens.  Boundaries are every shift start/end plus every faceoff and (non-shootout) goal
time, so each stint has one on-ice set, one score state and at most one zone start (the
faceoff at its first second).  Intervals are half-open in time; events are assigned with the
lake's boundary rule (DESIGN §3.0, ``bu.lake.onice``):

* a shot or goal at period second ``t`` belongs to the stint ``(start, end]`` that ends at or
  after ``t`` (the players whose shift ends at ``t`` were on for it);
* a faceoff at ``t`` opens the stint that *starts* at ``t``.

Goalies are kept apart from skaters, and on-ice skater lists are never truncated.  Strength
is the home-perspective ``{home skaters}v{away skaters}`` with both goalie counts.  Adjacent
stints with identical on-ice sets are not merged: two rows with the same design row are
equivalent to one row with the summed weight in weighted least squares.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.lake.paths import Lake

FACEOFF = 502
GOAL = 505
FLIP_ZONE = {"O": "D", "D": "O", "N": "N"}

STINT_COLUMNS = [
    "game_id", "season", "game_date", "game_type", "period", "start_s", "end_s", "dur",
    "home_team_id", "away_team_id", "home_sk", "away_sk", "n_home_sk", "n_away_sk",
    "n_home_g", "n_away_g", "home_goalie_id", "away_goalie_id", "home_diff", "zone_home",
    "xg_home", "xg_away", "xgf_home", "xgf_away", "g_home", "g_away", "sh_home", "sh_away", "game_onice_match",
]
MIN_GAME_ONICE_MATCH = 0.90   # games whose shift charts disagree with situationCode on >10% of shots are
                              # left out of the regression (e.g. 138 games of 2019-20 with broken charts)


def _game_stints(gid, sh: pd.DataFrame, fo: pd.DataFrame, goals: pd.DataFrame, shots: pd.DataFrame,
                 home_id: int, away_id: int) -> list[dict]:
    rows: list[dict] = []
    # running score from goals: (period, t, is_home)
    g_per = goals["period"].to_numpy(dtype=int) if len(goals) else np.zeros(0, int)
    g_t = goals["period_seconds"].to_numpy(dtype=float) if len(goals) else np.zeros(0)
    g_home = goals["is_home"].to_numpy(dtype=bool) if len(goals) else np.zeros(0, bool)
    for period, sp in sh.groupby("period", sort=True):
        st = sp["start_s"].to_numpy(dtype=float)
        en = sp["end_s"].to_numpy(dtype=float)
        pids = sp["player_id"].to_numpy(dtype=np.int64)
        is_home = sp["team_id"].to_numpy() == home_id
        is_g = sp["is_goalie"].to_numpy(dtype=bool)
        fo_p = fo[fo["period"] == period]
        go_p = g_t[g_per == period]
        bnd = np.unique(np.concatenate([st, en, fo_p["period_seconds"].to_numpy(dtype=float), go_p, [0.0]]))
        if len(bnd) < 2:
            continue
        a, b = bnd[:-1], bnd[1:]
        cover = (st[:, None] <= a[None, :]) & (en[:, None] >= b[None, :])  # [shifts, intervals]
        hs = cover & (is_home & ~is_g)[:, None]
        as_ = cover & (~is_home & ~is_g)[:, None]
        hg = cover & (is_home & is_g)[:, None]
        ag = cover & (~is_home & is_g)[:, None]
        n_hs, n_as, n_hg, n_ag = hs.sum(0), as_.sum(0), hg.sum(0), ag.sum(0)
        # score before each interval: goals of earlier periods + this period's goals at t <= a
        prior_h = int(((g_per < period) & g_home).sum())
        prior_a = int(((g_per < period) & ~g_home).sum())
        ph = go_p[g_home[g_per == period]]
        pa = go_p[~g_home[g_per == period]]
        sh_h = prior_h + np.searchsorted(np.sort(ph), a, side="right")
        sh_a = prior_a + np.searchsorted(np.sort(pa), a, side="right")
        # faceoff zone at interval start (home perspective)
        zone = np.array([""] * len(a), dtype=object)
        if len(fo_p):
            k = np.searchsorted(a, fo_p["period_seconds"].to_numpy(dtype=float))
            ok = (k < len(a)) & (a[np.minimum(k, len(a) - 1)] == fo_p["period_seconds"].to_numpy(dtype=float))
            for kk, zc, own in zip(k[ok], fo_p["zone_code"].to_numpy()[ok], fo_p["event_team_id"].to_numpy()[ok]):
                if zc in FLIP_ZONE:
                    zone[kk] = zc if own == home_id else FLIP_ZONE[zc]
        # shots: (start, end] rule; t = 0 goes to the first interval
        agg = np.zeros((len(a), 8))
        sp_sh = shots[shots["period"] == period]
        if len(sp_sh):
            t = sp_sh["period_seconds"].to_numpy(dtype=float)
            k = np.clip(np.searchsorted(b, t, side="left"), 0, len(a) - 1)
            hm = sp_sh["acting_is_home"].to_numpy(dtype=bool)
            xg = sp_sh["xg"].to_numpy(dtype=float)
            xf = sp_sh["xg_flurry"].to_numpy(dtype=float)
            gl = sp_sh["is_goal"].to_numpy(dtype=float)
            for col, vals, side in ((0, xg, hm), (1, xg, ~hm), (2, xf, hm), (3, xf, ~hm),
                                    (4, gl, hm), (5, gl, ~hm), (6, np.ones_like(xg), hm), (7, np.ones_like(xg), ~hm)):
                np.add.at(agg[:, col], k[side], vals[side])
        for i in range(len(a)):
            if n_hs[i] == 0 and n_as[i] == 0:
                continue
            hgi = pids[hg[:, i]]
            agi = pids[ag[:, i]]
            rows.append({
                "game_id": gid, "period": int(period), "start_s": int(a[i]), "end_s": int(b[i]),
                "dur": int(b[i] - a[i]),
                "home_sk": sorted(int(p) for p in pids[hs[:, i]]),
                "away_sk": sorted(int(p) for p in pids[as_[:, i]]),
                "n_home_sk": int(n_hs[i]), "n_away_sk": int(n_as[i]),
                "n_home_g": int(n_hg[i]), "n_away_g": int(n_ag[i]),
                "home_goalie_id": int(hgi[0]) if len(hgi) == 1 else 0,
                "away_goalie_id": int(agi[0]) if len(agi) == 1 else 0,
                "home_diff": int(sh_h[i] - sh_a[i]), "zone_home": zone[i],
                "xg_home": agg[i, 0], "xg_away": agg[i, 1], "xgf_home": agg[i, 2], "xgf_away": agg[i, 3],
                "g_home": int(agg[i, 4]), "g_away": int(agg[i, 5]),
                "sh_home": int(agg[i, 6]), "sh_away": int(agg[i, 7]),
            })
    return rows


def build_stints(lake: Lake, season: str, xg: pd.DataFrame) -> pd.DataFrame:
    """All stints of ``season`` (every strength; filter with ``ev_mask``/``strength``)."""
    games = read_table(lake, "games", [season], columns=["game_id", "game_date", "game_type", "home_team_id",
                                                         "away_team_id", "has_shifts"])
    shifts = read_table(lake, "shifts", [season], columns=["game_id", "player_id", "team_id", "period",
                                                           "start_s", "end_s", "is_goalie"])
    ev = read_table(lake, "events", [season], columns=["game_id", "event_id", "period", "period_type",
                                                       "period_seconds", "type_code", "zone_code",
                                                       "event_team_id"])
    if games.empty or shifts.empty:
        return pd.DataFrame(columns=STINT_COLUMNS)
    ev = ev[ev["period_type"] != "SO"]
    gm = games.set_index("game_id")
    fo_all = ev[ev["type_code"] == FACEOFF]
    goals_all = ev[ev["type_code"] == GOAL].merge(games[["game_id", "home_team_id"]], on="game_id")
    goals_all["is_home"] = goals_all["event_team_id"] == goals_all["home_team_id"]
    shots = xg.merge(ev[["game_id", "event_id", "period_seconds"]], on=["game_id", "event_id"], how="left")
    shots = shots[shots["period_seconds"].notna()]
    shifts = shifts[shifts["team_id"].notna()]
    by_fo = dict(tuple(fo_all.groupby("game_id")))
    by_goal = dict(tuple(goals_all.groupby("game_id")))
    by_shot = dict(tuple(shots.groupby("game_id")))
    empty_fo, empty_goal, empty_shot = fo_all.iloc[:0], goals_all.iloc[:0], shots.iloc[:0]
    rows = []
    for gid, sh in shifts.groupby("game_id", sort=True):
        if gid not in gm.index:
            continue
        g = gm.loc[gid]
        rows.extend(_game_stints(gid, sh, by_fo.get(gid, empty_fo), by_goal.get(gid, empty_goal),
                                 by_shot.get(gid, empty_shot), int(g["home_team_id"]), int(g["away_team_id"])))
    st = pd.DataFrame(rows)
    if st.empty:
        return pd.DataFrame(columns=STINT_COLUMNS)
    st["season"] = season
    st = st.merge(games[["game_id", "game_date", "game_type", "home_team_id", "away_team_id"]], on="game_id")
    q = read_table(lake, "shots", [season], columns=["game_id", "onice_rule"])
    q = q[q["onice_rule"] != "nosit"]
    match = q["onice_rule"].isin(["primary", "alt"]).groupby(q["game_id"]).mean()
    st["game_onice_match"] = st["game_id"].map(match).fillna(1.0).to_numpy()
    for c in ("game_type", "home_team_id", "away_team_id"):
        st[c] = st[c].astype(int)
    return st[STINT_COLUMNS]


def strength_label(st: pd.DataFrame) -> pd.Series:
    """'5v5', '4v4', '3v3', '5v4', '4v5', ..., with 'EN' when a goalie is pulled (home view)."""
    lab = st["n_home_sk"].astype(str) + "v" + st["n_away_sk"].astype(str)
    return lab.where((st["n_home_g"] == 1) & (st["n_away_g"] == 1), "EN")


def ev_mask(st: pd.DataFrame) -> pd.Series:
    """Even strength with both goalies in: 5v5, 4v4, 3v3 (DESIGN §3.2)."""
    return ((st["n_home_g"] == 1) & (st["n_away_g"] == 1) & (st["n_home_sk"] == st["n_away_sk"])
            & st["n_home_sk"].between(3, 5))
