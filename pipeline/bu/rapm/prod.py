"""Production score (PROD): a recency-weighted NHL Game Score per game, descriptive, not a rating.

The site's ``impact`` is the predictive rating (RAPM with a box-score prior).  PROD sits next to it
as a plain production measure in the style of The Athletic: Dom Luszczyszyn's public Game Score
(2016), per player-game, from the lake's free NHL play-by-play:

    GS = 0.75 G + 0.7 A1 + 0.55 A2 + 0.075 SOG + 0.05 BLK + 0.15 PD - 0.15 PT
         + 0.01 FOW - 0.01 FOL + 0.05 CF - 0.05 CA + 0.15 GF - 0.15 GA

with every individual count in all situations (shootout excluded; SOG includes goals; BLK = shots
of the other team he blocked; PD / PT = penalties drawn / taken, misconducts not counted; faceoffs
won / lost) and CF / CA / GF / GA his on-ice 5v5 shot attempts (goals, shots on goal, missed and
blocked shots, penalty shots excluded) and goals for / against, both goalies in.  Every dressed
skater of a game with shift data gets a row, so a quiet game counts as a game with a low score.

Recency and as-of are the ratings' (``v3.RECENCY``: per-game decay, half-life 90 league games,
weight 0 past 246; this season's games up to the ratings' cutoff):

    sw  = sum_games w,      sgs = sum_games w GS
    gs_pg = (sgs + K m) / (sw + K)          (K pseudo-games of the position mean m)
    prod  = 82 (gs_pg - m)                  (Game Score per 82 games above the F / D average)

``m`` is the position group's (F / D) games-weighted mean Game Score per game, ``sum sgs / sum sw``
over the rated roster skaters of the group (``bu.lineup.ratings_export``, like the impact's
baseline), so an average-producing forward is 0.  ``K`` = ``PSEUDO_GAMES``, tuned on the 2019-23
seasons for next-season repeatability (``python -m bu.rapm.prod tune``, ``out/prod_validation.json``).

Live path (CI has only this season's lake): the committed ``bu/lineup/out/prod_pack_<S>.json.gz``
carries every player's pre-season sums on the ratings' in-season grid (``v3.G_GRID``), built once
per season from the full lake (``python -m bu.rapm.prod pack``); ``bu.lineup serve`` adds this
season's games (``bundle_table``: the bundle's ``prod`` table) and ``ratings_export`` shrinks,
centres and writes ``prod`` / ``gs_pg`` into ``player_ratings.json``.
"""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .recency import LeagueClock, Recency, league_index

WEIGHTS = {"g": 0.75, "a1": 0.7, "a2": 0.55, "sog": 0.075, "blk": 0.05, "pd": 0.15, "pt": -0.15,
           "fow": 0.01, "fol": -0.01, "cf": 0.05, "ca": -0.05, "gf": 0.15, "ga": -0.15}
COUNT_COLS = list(WEIGHTS)
PSEUDO_GAMES = 5.0           # K (out/prod_validation.json: tuning seasons 2019-23, next-season GS/GP MSE)
GAMES = 82
PACK_VERSION = 1
PACK_KIND = "prod_pack"
TABLE_COLUMNS = ["player_id", "group", "n", "sw", "sgs"]
ATTEMPTS = ("goal", "shot-on-goal", "missed-shot", "blocked-shot")


def _b(s) -> np.ndarray:
    return pd.Series(s).astype("boolean").fillna(False).to_numpy(bool)


def game_counts(events: pd.DataFrame, lineups: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    """Per (game_id, d, player_id): ``group`` (F / D), ``COUNT_COLS`` and ``gs`` (Game Score), one row
    per dressed skater of every regular-season / playoff game with shift data (on-ice sets)."""
    g = games[games["game_type"].isin([2, 3]) & _b(games["has_shifts"])]
    g = g[["game_id", "game_date", "home_team_id"]].copy()
    g["d"] = pd.to_datetime(g["game_date"]).values.astype("datetime64[D]")
    ids = set(g["game_id"].astype(np.int64))
    lu = lineups[lineups["game_id"].isin(ids) & ~_b(lineups["is_goalie"])]
    if "status" in lu.columns:
        lu = lu[lu["status"].astype(str) == "dressed"]
    lu = lu.drop_duplicates(["game_id", "player_id"])
    base = pd.DataFrame({"game_id": lu["game_id"].astype(np.int64).to_numpy(),
                         "player_id": lu["player_id"].astype(np.int64).to_numpy(),
                         "is_home": _b(lu["is_home"]),
                         "group": np.where(lu["position"].astype(str).str.upper().str.startswith("D"), "D", "F")})
    e = events[events["game_id"].isin(ids)]
    e = e[(e["period_type"].astype(str) != "SO") & ~_b(e["is_shootout"])]
    typ = e["type_desc"].astype(str).to_numpy()
    pshot = _b(e["is_penalty_shot"])
    parts = []

    def add(mask, pid_col, col):
        p = pd.to_numeric(e.loc[mask, pid_col], errors="coerce")
        ok = p.notna().to_numpy()
        if ok.any():
            parts.append(pd.DataFrame({"game_id": e.loc[mask, "game_id"].to_numpy()[ok].astype(np.int64),
                                       "player_id": p.to_numpy()[ok].astype(np.int64), "col": col, "v": 1.0}))

    goal = typ == "goal"
    add(goal, "scorer_id", "g")
    add(goal, "assist1_id", "a1")
    add(goal, "assist2_id", "a2")
    shooter = e["shooter_id"].where(e["shooter_id"].notna(), e["scorer_id"])
    sog = np.isin(typ, ("goal", "shot-on-goal"))
    p = pd.to_numeric(shooter[sog], errors="coerce")
    ok = p.notna().to_numpy()
    parts.append(pd.DataFrame({"game_id": e.loc[sog, "game_id"].to_numpy()[ok].astype(np.int64),
                               "player_id": p.to_numpy()[ok].astype(np.int64), "col": "sog", "v": 1.0}))
    # blocks: shots of the other team (the lake also logs teammate blocks, reason "teammate-blocked")
    add((typ == "blocked-shot") & (e["reason"].astype(str) != "teammate-blocked").to_numpy(), "blocker_id", "blk")
    pen = (typ == "penalty") & ~e["pen_desc_key"].fillna("").astype(str).str.contains("misconduct").to_numpy()
    add(pen, "pen_committed_by_id", "pt")
    add(pen, "pen_drawn_by_id", "pd")
    fo = typ == "faceoff"
    add(fo, "fo_winner_id", "fow")
    add(fo, "fo_loser_id", "fol")
    # on-ice 5v5 (both goalies in): attempts and goals for / against
    five = ((e["sit_home_sk"] == 5) & (e["sit_away_sk"] == 5) & (e["sit_home_g"] == 1)
            & (e["sit_away_g"] == 1)).fillna(False).to_numpy(bool)
    att = five & np.isin(typ, ATTEMPTS) & ~pshot
    a = e.loc[att, ["game_id", "shooting_team_id", "home_skaters", "away_skaters", "type_desc"]]
    a = a.merge(g[["game_id", "home_team_id"]], on="game_id", how="inner")
    if len(a):
        home_shot = (a["shooting_team_id"].astype("Int64") == a["home_team_id"].astype("Int64")).fillna(False)
        is_goal = (a["type_desc"] == "goal").to_numpy()
        for side, mine in (("home_skaters", home_shot.to_numpy(bool)), ("away_skaters", ~home_shot.to_numpy(bool))):
            x = pd.DataFrame({"game_id": a["game_id"].to_numpy(np.int64), "pl": a[side].to_numpy(),
                              "f": mine, "goal": is_goal})
            x = x[x["pl"].notna()].explode("pl")
            x = x[x["pl"].notna()]
            if not len(x):
                continue
            pid = x["pl"].astype(np.int64).to_numpy()
            gidx = x["game_id"].to_numpy(np.int64)
            f, gl = x["f"].to_numpy(bool), x["goal"].to_numpy(bool)
            parts.append(pd.DataFrame({"game_id": gidx, "player_id": pid, "col": np.where(f, "cf", "ca"), "v": 1.0}))
            if gl.any():
                parts.append(pd.DataFrame({"game_id": gidx[gl], "player_id": pid[gl],
                                           "col": np.where(f[gl], "gf", "ga"), "v": 1.0}))
    r = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["game_id", "player_id", "col", "v"])
    c = (r.groupby(["game_id", "player_id", "col"])["v"].sum().unstack("col", fill_value=0.0)
         if len(r) else pd.DataFrame(index=pd.MultiIndex.from_tuples([], names=["game_id", "player_id"])))
    c = c.reindex(columns=COUNT_COLS, fill_value=0.0).reset_index()
    out = base.merge(c, on=["game_id", "player_id"], how="left").merge(g[["game_id", "d"]], on="game_id")
    out[COUNT_COLS] = out[COUNT_COLS].fillna(0.0)
    out["gs"] = out[COUNT_COLS].to_numpy(float) @ np.array([WEIGHTS[k] for k in COUNT_COLS])
    return out[["game_id", "d", "player_id", "group"] + COUNT_COLS + ["gs"]].reset_index(drop=True)


def season_counts(lake, season: str, cache_dir: str | None = None, log=print) -> pd.DataFrame:
    """``game_counts`` of one lake season (cached as parquet under ``cache_dir`` when given)."""
    from bu.lake.build import read_table
    p = os.path.join(cache_dir, f"prod_season={season}.parquet") if cache_dir else None
    if p and os.path.exists(p):
        return pd.read_parquet(p)
    ev = read_table(lake, "events", [season])
    lu = read_table(lake, "lineups", [season])
    gm = read_table(lake, "games", [season])
    if not len(ev) or not len(gm):
        return game_counts(pd.DataFrame(columns=ev.columns), lu.iloc[:0], gm.iloc[:0]) if len(gm) else pd.DataFrame(
            columns=["game_id", "d", "player_id", "group"] + COUNT_COLS + ["gs"])
    pg = game_counts(ev, lu, gm)
    if p:
        os.makedirs(cache_dir, exist_ok=True)
        pg.to_parquet(p + ".tmp", index=False)
        os.replace(p + ".tmp", p)
    log(f"  [prod] {season}: {len(pg):,} skater-games, mean GS {pg['gs'].mean():.3f}")
    return pg


# ----------------------------------------------------------------------- weighted sums

def sums(pg: pd.DataFrame, w: np.ndarray) -> pd.DataFrame:
    """Per player: ``group`` (his latest), ``n`` (games with weight > 0), ``sw``, ``sgs``."""
    if not len(pg):
        return pd.DataFrame(columns=["group", "n", "sw", "sgs"]).rename_axis("player_id")
    df = pd.DataFrame({"player_id": pg["player_id"].to_numpy(np.int64), "d": pg["d"].to_numpy(),
                       "group": pg["group"].to_numpy(), "w": w, "n": (w > 0).astype(float),
                       "wgs": w * pg["gs"].to_numpy(float)})
    df = df[df["w"] > 0]
    if not len(df):
        return pd.DataFrame(columns=["group", "n", "sw", "sgs"]).rename_axis("player_id")
    df = df.sort_values("d")
    a = df.groupby("player_id").agg(group=("group", "last"), n=("n", "sum"), sw=("w", "sum"), sgs=("wgs", "sum"))
    return a


def add_sums(*tabs) -> pd.DataFrame:
    tabs = [t for t in tabs if t is not None and len(t)]
    if not tabs:
        return pd.DataFrame(columns=["group", "n", "sw", "sgs"]).rename_axis("player_id")
    t = pd.concat(tabs)
    grp = t.groupby(level=0)["group"].last()
    s = t[["n", "sw", "sgs"]].groupby(level=0).sum()
    s.insert(0, "group", grp)
    return s


def pre_sums(pg_prev: pd.DataFrame, clock: LeagueClock, S: str, g: float, rec: Recency) -> pd.DataFrame:
    """Weighted sums of every game before season S, seen ``g`` games into S (``v3.fin_pre``'s weights)."""
    if not len(pg_prev):
        return add_sums()
    L0 = clock.season_start(S)
    L = clock.before(pg_prev["d"].to_numpy(dtype="datetime64[D]"))
    pre = pg_prev[L < L0 + 1e-9]
    L = L[L < L0 + 1e-9]
    return sums(pre, rec.weight(g + (L0 - L)))


def in_sums(pg_cur: pd.DataFrame, clock: LeagueClock, asof, rec: Recency, lag_days: int = 2) -> pd.DataFrame:
    """This season's weighted sums as of ``asof`` (games up to ``asof - lag_days``, ``v3.fin_in``'s weights)."""
    if not len(pg_cur):
        return add_sums()
    d = pg_cur["d"].to_numpy(dtype="datetime64[D]")
    cutoff = np.datetime64(asof, "D") - np.timedelta64(lag_days, "D")
    w = np.where(d <= cutoff, rec.weight(float(clock.before([asof])[0]) - clock.before(d)), 0.0)
    return sums(pg_cur, w)


def interp(a: pd.DataFrame, b: pd.DataFrame, t: float) -> pd.DataFrame:
    if t <= 0:
        return a
    idx = a.index.union(b.index)
    grp = b["group"].reindex(idx).fillna(a["group"].reindex(idx))
    num = a[["n", "sw", "sgs"]].reindex(idx).fillna(0.0) * (1 - t) + b[["n", "sw", "sgs"]].reindex(idx).fillna(0.0) * t
    num.insert(0, "group", grp)
    return num


def shrink(sw, sgs, m, k: float = PSEUDO_GAMES):
    """(gs_pg, prod): Game Score per game shrunk to ``m`` with ``k`` pseudo-games; per 82 above ``m``."""
    sw, sgs, m = np.asarray(sw, float), np.asarray(sgs, float), np.asarray(m, float)
    gs = (sgs + k * m) / (sw + k) if k > 0 else np.where(sw > 0, sgs / np.where(sw > 0, sw, 1.0), m)
    return gs, GAMES * (gs - m)


def group_means(tab: pd.DataFrame, mask=None) -> dict:
    """{'F': m, 'D': m}: games-weighted mean Game Score per game (``sum sgs / sum sw``)."""
    t = tab if mask is None else tab[mask]
    out = {}
    for g in ("F", "D"):
        s = t[t["group"] == g]
        out[g] = float(s["sgs"].sum() / s["sw"].sum()) if len(s) and s["sw"].sum() > 0 else 0.0
    return out


# ----------------------------------------------------------------------- season pack

def pack_path(season: str) -> str:
    from bu.lineup.evaluate import OUT_DIR
    return os.path.join(OUT_DIR, f"prod_pack_{season}.json.gz")


def _clock_games(lake, seasons) -> pd.DataFrame:
    from bu.lake.build import read_table
    return read_table(lake, "games", seasons, columns=["season", "game_id", "game_date", "game_type",
                                                       "home_team_id", "away_team_id"])


def history(lake, S: str, cache_dir: str | None = None, n_back: int = 4, log=print):
    """(per-game counts of the ``n_back`` seasons before S, league clock through S)."""
    from bu.rapm.data import lake_seasons
    have = sorted(lake_seasons(lake))
    prev = [s for s in have if s < str(S)][-n_back:]
    pg = pd.concat([season_counts(lake, s, cache_dir, log) for s in prev], ignore_index=True) if prev else pd.DataFrame()
    clk = LeagueClock(league_index(_clock_games(lake, prev + [s for s in have if s == str(S)])))
    return pg, clk


def build_pack(lake, S: str, rec: Recency | None = None, k: float = PSEUDO_GAMES, cache_dir: str | None = None,
               log=print) -> dict:
    """Season-start pack of season S: per player pre-season ``n`` / ``sw`` / ``sgs`` at every ``v3.G_GRID`` point."""
    from . import v3 as V
    rec = rec or V.RECENCY
    S = str(S)
    pg, clk = history(lake, S, cache_dir, log=log)
    grid = []
    for g in V.G_GRID:
        t = pre_sums(pg, clk, S, float(g), rec)
        t = t[t["sw"] > 1e-9]
        grid.append({"g": float(g), "rows": [[int(p), str(r.group), round(float(r.n), 3), round(float(r.sw), 4),
                                              round(float(r.sgs), 4)] for p, r in zip(t.index, t.itertuples(index=False))]})
        log(f"  [prod-pack] {S} g={g:g}: {len(t)} players")
    return {"version": PACK_VERSION, "kind": PACK_KIND, "season": S,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "config": {"recency": rec.as_dict(), "pseudo_games": float(k), "weights": WEIGHTS, "games": GAMES},
            "columns": TABLE_COLUMNS, "grid": grid}


def write_pack(path: str, pack: dict) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path + ".tmp", "wt") as f:
        json.dump(pack, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return path


def read_pack(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as f:
        p = json.load(f)
    if int(p.get("version", 0)) != PACK_VERSION or p.get("kind") != PACK_KIND:
        raise ValueError(f"{path}: not a prod pack of version {PACK_VERSION}")
    return p


def _grid_tab(rows) -> pd.DataFrame:
    if not rows:
        return add_sums()
    t = pd.DataFrame(rows, columns=TABLE_COLUMNS).set_index("player_id")
    return t.astype({"n": float, "sw": float, "sgs": float})


def pack_prior(pack: dict, g: float) -> pd.DataFrame:
    """The pre-season sums at ``g`` (linear between grid points)."""
    gs = np.array([x["g"] for x in pack["grid"]], float)
    g = float(np.clip(g, gs.min(), gs.max()))
    k = min(int(np.searchsorted(gs, g, side="right")) - 1, len(gs) - 1)
    a = _grid_tab(pack["grid"][k]["rows"])
    if k == len(gs) - 1 or g - gs[k] < 1e-9:
        return a
    return interp(a, _grid_tab(pack["grid"][k + 1]["rows"]), (g - gs[k]) / (gs[k + 1] - gs[k]))


def bundle_table(paths, season: str, asof=None, g: float | None = None, pack_file: str | None = None,
                 log=print) -> dict | None:
    """The serving bundle's ``prod`` table: the season's prod pack plus this season's lake games, as of
    the ratings' ``asof`` / ``g`` (the ``v4`` table's meta; else the last game date + ``v3.LAG_DAYS``).
    Columns ``TABLE_COLUMNS`` (``n`` games with weight, ``sw`` weighted games, ``sgs`` weighted Game
    Score); ``meta.pseudo_games`` is the shrinkage ``ratings_export`` applies.  None without a pack."""
    from bu.lake.build import read_table
    from bu.rapm.data import lake_seasons
    from . import v3 as V
    from .v3_pack import season_clock
    pf = pack_file or pack_path(season)
    pack = read_pack(pf)
    if pack is None:
        log(f"  [prod] no {os.path.basename(pf)}: no prod table in the bundle")
        return None
    S = str(season)
    rec = Recency.from_dict(pack["config"]["recency"])
    cur = add_sums()
    last = None
    if S in lake_seasons(paths.lake):
        games = read_table(paths.lake, "games", [S])
        pg = season_counts(paths.lake, S, log=log)
        if len(pg):
            last = pg["d"].max()
            flags = [c for c in ("has_shifts", "has_boxscore") if c in games.columns]
            played = games[np.logical_or.reduce([_b(games[c]) for c in flags])] if flags else games
            clk = season_clock(played)
            if asof is None:
                asof = np.datetime64(last, "D") + np.timedelta64(V.LAG_DAYS, "D")
            if g is None:
                g = clk.in_season(S, asof)
            cur = in_sums(pg, clk, asof, rec, V.LAG_DAYS)
    g = float(g or 0.0)
    tab = add_sums(pack_prior(pack, g), cur)
    tab = tab[tab["sw"] > 1e-9]
    rows = [[int(p), str(r.group), round(float(r.n), 3), round(float(r.sw), 4), round(float(r.sgs), 4)]
            for p, r in zip(tab.index, tab.itertuples(index=False))]
    return {"columns": TABLE_COLUMNS, "rows": rows,
            "meta": {"pack": os.path.basename(pf), "season": S, "g": round(g, 3),
                     "asof": None if asof is None else str(np.datetime64(asof, "D")),
                     "max_source_date": None if last is None else str(np.datetime64(last, "D")),
                     "pseudo_games": float(pack["config"]["pseudo_games"]), "weights": pack["config"]["weights"],
                     "recency": pack["config"]["recency"], "games": GAMES}}


# ----------------------------------------------------------------------- tuning (next-season repeatability)

def tune(lake, seasons, grid=(0, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 60), cache_dir: str | None = None, min_gp: int = 10,
         log=print) -> dict:
    """For each tuning season S: the season-start sums (g = 0) predict the player's Game Score per game
    in S; games-weighted MSE (and correlation) for every pseudo-game count in ``grid``.  Players with a
    prior sample and ``min_gp`` games in S; the shrink target is the league position mean at S start."""
    from . import v3 as V
    from bu.rapm.data import lake_seasons
    rec = V.RECENCY
    have = sorted(lake_seasons(lake))
    allseas = sorted({s for S in seasons for s in have if s <= str(S)})[-(len(seasons) + 4):]
    pg = {s: season_counts(lake, s, cache_dir, log) for s in allseas}
    clk = LeagueClock(league_index(_clock_games(lake, allseas)))
    per, pooled = {}, {k: [0.0, 0.0] for k in grid}
    rows_all = []
    for S in seasons:
        S = str(S)
        prev = pd.concat([pg[s] for s in allseas if s < S], ignore_index=True)
        pre = pre_sums(prev, clk, S, 0.0, rec)
        pre = pre[pre["sw"] > 0]
        y = pg[S].groupby("player_id").agg(gp=("gs", "size"), y=("gs", "mean"))
        y = y[y["gp"] >= min_gp]
        j = pre.join(y, how="inner")
        m = group_means(pre)
        mm = j["group"].map(m).to_numpy(float)
        res = {}
        for k in grid:
            pred, _ = shrink(j["sw"], j["sgs"], mm, float(k))
            err = j["y"].to_numpy() - pred
            w = j["gp"].to_numpy(float)
            mse = float(np.average(err ** 2, weights=w))
            c = float(np.corrcoef(pred, j["y"])[0, 1])
            res[str(k)] = {"mse": round(mse, 6), "r": round(c, 4)}
            pooled[k][0] += float((w * err ** 2).sum())
            pooled[k][1] += float(w.sum())
        per[S] = {"n": int(len(j)), "means": {g_: round(v, 4) for g_, v in m.items()}, "by_k": res}
        rows_all.append(j.assign(season=S))
        log(f"  [prod-tune] {S}: n={len(j)} " + " ".join(f"k{k}={res[str(k)]['mse']:.5f}" for k in grid))
    pm = {str(k): round(v[0] / v[1], 6) for k, v in pooled.items()}
    best = min(grid, key=lambda k: pm[str(k)])
    # split-half style descriptive: raw next-season repeatability of the unshrunk per-game score
    return {"kind": "prod_validation", "seasons": [str(s) for s in seasons], "min_gp": min_gp,
            "recency": rec.as_dict(), "weights": WEIGHTS, "grid": list(grid), "pooled_mse": pm, "best_k": best,
            "per_season": per, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main(argv=None) -> int:
    import argparse
    from bu.lake.paths import Lake
    ap = argparse.ArgumentParser(prog="python -m bu.rapm.prod", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["pack", "tune"])
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--cache", default=None, help="per-season count cache dir (default: <lake>/state/rapm/prod)")
    ap.add_argument("--season", default=None, help="pack: the season the pack starts")
    ap.add_argument("--seasons", default="20192020,20202021,20212022,20222023", help="tune: tuning seasons")
    ap.add_argument("--out", default=None, help="tune: report path (default bu/rapm/out/prod_validation.json)")
    a = ap.parse_args(argv)
    lake = Lake(a.lake_dir)
    cache = a.cache or os.path.join(lake.root, "state", "rapm", "prod")
    if a.command == "tune":
        rep = tune(lake, a.seasons.split(","), cache_dir=cache)
        from .paths import REPORT_DIR
        out = a.out or os.path.join(REPORT_DIR, "prod_validation.json")
        with open(out, "w") as f:
            json.dump(rep, f, indent=1)
        print(f"  [prod-tune] pooled MSE {rep['pooled_mse']} -> best K {rep['best_k']} ({out})")
        return 0
    if not a.season:
        from season import SEASON_ID
        a.season = str(SEASON_ID)
    pk = build_pack(lake, a.season, cache_dir=cache)
    print(f"  [prod-pack] -> {write_pack(pack_path(a.season), pk)}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
