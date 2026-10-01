"""Stints -> weighted regression rows (DESIGN §3.2, Evolving-Hockey / Magnus layout).

Each EV stint becomes two rows, one per attacking side:

    y = attacking side's flurry-adjusted xG per 60       w = stint seconds (x era weight)
    X = +1 in the O column of each attacking skater, +1 in the D column of each defending
        skater (goalies excluded), plus covariates from the attacking side's view.

A positive D coefficient therefore means *more* xG allowed (worse defence).  Covariates
(reference levels in brackets):

    intercept                  league 5v5 xGF/60 for the season (lightly penalised)
    home                       attacking side is the home team
    score_m3..score_p3         attacking side's goal difference, clipped to +-3 [tied]
    p3_lead, p3_trail          third-period shell term (leading / trailing in period 3)
    zone_O, zone_N, zone_D     faceoff zone at the stint's first second [on the fly]
    st_4v4, st_3v3             strength [5v5]
    b2b_att, b2b_def           attacking / defending team on the 2nd night of a back-to-back

Entities are generic so the same machinery fits players (RAPM) or teams (team-only baseline).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import scipy.sparse as sp

from bu.lake.build import read_table

COVARIATES = ["intercept", "home", "score_m3", "score_m2", "score_m1", "score_p1", "score_p2", "score_p3",
              "p3_lead", "p3_trail", "zone_O", "zone_N", "zone_D", "st_4v4", "st_3v3", "b2b_att", "b2b_def"]
ERA_WEIGHTS = {"20202021": 0.5}  # DESIGN §3.2.1: 2020-21 (empty arenas, compressed schedule) at 0.5


def back_to_back(lake, seasons) -> dict[tuple[int, int], int]:
    """(game_id, team_id) -> 1 if the team also played the previous calendar day."""
    g = read_table(lake, "games", seasons, columns=["game_id", "game_date", "home_team_id", "away_team_id"])
    if g.empty:
        return {}
    long = pd.concat([g[["game_id", "game_date", "home_team_id"]].rename(columns={"home_team_id": "team_id"}),
                      g[["game_id", "game_date", "away_team_id"]].rename(columns={"away_team_id": "team_id"})])
    long["d"] = pd.to_datetime(long["game_date"])
    long = long.sort_values(["team_id", "d"])
    prev = long.groupby("team_id")["d"].shift(1)
    long["b2b"] = ((long["d"] - prev).dt.days == 1).astype(int)
    return {(int(a), int(b)): int(c) for a, b, c in zip(long["game_id"], long["team_id"], long["b2b"])}


@dataclass
class Rows:
    """Two rows per stint, in stint order (home-attacking row first)."""
    att: list            # list of entity-id lists (attacking side)
    dfn: list            # list of entity-id lists (defending side)
    cov: np.ndarray      # [rows, n_cov]
    y: np.ndarray        # xG/60 of the attacking side
    w: np.ndarray        # weight (seconds x era weight)
    date: np.ndarray     # game_date (datetime64[D])
    game_id: np.ndarray
    att_team: np.ndarray
    def_team: np.ndarray

    def __len__(self):
        return len(self.y)

    def subset(self, mask: np.ndarray) -> "Rows":
        idx = np.flatnonzero(mask)
        return Rows([self.att[i] for i in idx], [self.dfn[i] for i in idx], self.cov[idx], self.y[idx],
                    self.w[idx], self.date[idx], self.game_id[idx], self.att_team[idx], self.def_team[idx])


def stint_rows(st: pd.DataFrame, b2b: dict | None = None, target: str = "xgf", entity: str = "player") -> Rows:
    """``st``: EV stints of one season.  ``target``: 'xgf' (flurry xG), 'xg' or 'g' (goals)."""
    b2b = b2b or {}
    n = len(st)
    dur = st["dur"].to_numpy(dtype=float)
    era = st["season"].astype(str).map(ERA_WEIGHTS).fillna(1.0).to_numpy(dtype=float)
    tgt_h = st[f"{target}_home"].to_numpy(dtype=float)
    tgt_a = st[f"{target}_away"].to_numpy(dtype=float)
    diff = st["home_diff"].to_numpy(dtype=int)
    per = st["period"].to_numpy(dtype=int)
    zone = st["zone_home"].fillna("").to_numpy()
    nsk = st["n_home_sk"].to_numpy(dtype=int)
    gid = st["game_id"].to_numpy(dtype=np.int64)
    ht = st["home_team_id"].to_numpy(dtype=np.int64)
    at = st["away_team_id"].to_numpy(dtype=np.int64)
    b2b_h = np.array([b2b.get((int(g), int(t)), 0) for g, t in zip(gid, ht)])
    b2b_a = np.array([b2b.get((int(g), int(t)), 0) for g, t in zip(gid, at)])

    def covs(sign: int, is_home: int, zone_side: np.ndarray, b_att, b_def):
        c = np.zeros((n, len(COVARIATES)))
        c[:, 0] = 1.0
        c[:, 1] = is_home
        d = np.clip(sign * diff, -3, 3)
        for j, v in enumerate((-3, -2, -1, 1, 2, 3)):
            c[:, 2 + j] = d == v
        p3 = per == 3
        c[:, 8] = p3 & (d > 0)
        c[:, 9] = p3 & (d < 0)
        c[:, 10] = zone_side == "O"
        c[:, 11] = zone_side == "N"
        c[:, 12] = zone_side == "D"
        c[:, 13] = nsk == 4
        c[:, 14] = nsk == 3
        c[:, 15] = b_att
        c[:, 16] = b_def
        return c

    flip = {"O": "D", "D": "O", "N": "N", "": ""}
    zone_away = np.array([flip.get(z, "") for z in zone], dtype=object)
    cov_h = covs(+1, 1, zone, b2b_h, b2b_a)
    cov_a = covs(-1, 0, zone_away, b2b_a, b2b_h)
    if entity == "player":
        hs, as_ = list(st["home_sk"]), list(st["away_sk"])
    else:
        hs, as_ = [[int(t)] for t in ht], [[int(t)] for t in at]
    att, dfn = [], []
    for i in range(n):
        att.append(list(hs[i])); dfn.append(list(as_[i]))  # noqa: E702
        att.append(list(as_[i])); dfn.append(list(hs[i]))  # noqa: E702
    inter = lambda a, b: np.stack([a, b], axis=1).reshape(-1)  # noqa: E731
    cov = np.empty((2 * n, len(COVARIATES)))
    cov[0::2], cov[1::2] = cov_h, cov_a
    safe = np.maximum(dur, 1.0)
    y = inter(tgt_h * 3600.0 / safe, tgt_a * 3600.0 / safe)
    w = inter(dur * era, dur * era)
    date = pd.to_datetime(st["game_date"]).to_numpy(dtype="datetime64[D]")
    return Rows(att, dfn, cov, y, w, inter(date, date), inter(gid, gid), inter(ht, at), inter(at, ht))


class Index:
    """Column layout: [O_0..O_{n-1}, D_0..D_{n-1}, covariates]."""

    def __init__(self, entities):
        self.ids = np.array(sorted({int(e) for e in entities}), dtype=np.int64)
        self.pos = {int(e): i for i, e in enumerate(self.ids)}
        self.n = len(self.ids)
        self.n_cov = len(COVARIATES)
        self.p = 2 * self.n + self.n_cov

    def o(self, k):
        return k

    def d(self, k):
        return self.n + k

    def cov(self, j):
        return 2 * self.n + j

    @classmethod
    def from_rows(cls, rows: Rows, extra=()):
        ents = set(extra)
        for a in rows.att:
            ents.update(a)
        return cls(ents)


def design_matrix(rows: Rows, idx: Index) -> sp.csr_matrix:
    indptr = [0]
    indices: list[int] = []
    data: list[float] = []
    cov_cols = np.arange(idx.n_cov) + 2 * idx.n
    for i in range(len(rows)):
        for e in rows.att[i]:
            k = idx.pos.get(int(e))
            if k is not None:
                indices.append(k); data.append(1.0)  # noqa: E702
        for e in rows.dfn[i]:
            k = idx.pos.get(int(e))
            if k is not None:
                indices.append(idx.n + k); data.append(1.0)  # noqa: E702
        c = rows.cov[i]
        nz = np.flatnonzero(c)
        indices.extend(cov_cols[nz].tolist()); data.extend(c[nz].tolist())  # noqa: E702
        indptr.append(len(indices))
    return sp.csr_matrix((np.array(data), np.array(indices, dtype=np.int64), np.array(indptr, dtype=np.int64)),
                         shape=(len(rows), idx.p))
