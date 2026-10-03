"""Finishing talent FIN: shrunk even-strength goals above xG per 60 (DESIGN §3.3, simplified).

RAPM v2 ``o`` is an xG impact: a skater who turns his chances into goals more often than the
shot model expects gets no credit for it.  FIN is that missing piece, on the same scale (goals
per 60 of the player's EV time, so ``OFF_total = OFF + FIN`` reads as "team EV goals for per 60
the player adds"):

    multiplier  m_i = (G_i + PRIOR_XG) / (X_i + PRIOR_XG)        gamma-Poisson posterior mean
    volume      v_i = (X_i + VOL_PSEUDO_S * mu_g) / (S_i + VOL_PSEUDO_S) * 3600   ixG per 60, shrunk
    FIN_i       = (m_i - 1) * v_i                                 goals above xG per 60

over the player's own unblocked EV shots (5v5 / 4v4 / 3v3, shooter's team not facing an empty
net, penalty shots excluded) and his EV time.  In ``FinState`` G / X / S are season sums weighted
``DECAY ** k`` for k seasons back (two seasons back DECAY, then DECAY^2, ...); the tuned ``DECAY`` is
1.0, so every season since the first lake season (2010-11) counts EQUALLY - there is no decay in
the v2 numbers.  Player ratings v3 (``bu.rapm.v3``: ``fin_pre`` / ``fin_in`` / ``fin_values``) use
the same formula on game-recency-weighted sums instead (the ratings' per-game decay, nothing
older than 246 games) with ``v3.FIN_PRIOR_XG``.  Each completed season's xG is scaled by that
season's league EV goals/xG, the current season's by the league ratio so far (pseudo-count
``LEAGUE_PSEUDO_G``), so the league-average multiplier is 1 whatever the xG model's drift.
``mu_g`` is the league EV ixG per second of the player's position group (forwards / defence).

``PRIOR_XG`` and ``DECAY`` are tuned on the tuning seasons (2021-22, 2022-23) by held-out shot
log loss (``evaluate_shots``: every EV shot of a season, scored with the shooter's point-in-time
multiplier, games up to ``d - LAG_DAYS``) against xG alone; see ``bu/rapm/out/fin_validation.json``.

Point-in-time use: ``FinState`` is fed games in date order (``add_games``) and rolled at each
season boundary (``roll``), the same contract as ``bu.lineup.toi.ShareState``.
"""
from __future__ import annotations

import json
import math
import os
from collections import defaultdict

import numpy as np
import pandas as pd

EV_STRENGTHS = ("5v5", "4v4", "3v3")
PRIOR_XG = 60.0          # tuned (out/fin_validation.json, one-SE rule); shooting_talent.py uses 40 on 5v5 v1 xG
DECAY = 1.0              # tuned (best at the selected PRIOR_XG; 0.85 within 0.00001 per shot)
VOL_PSEUDO_S = 5 * 3600.0
MU_DEFAULT = {"F": 0.60 / 3600.0, "D": 0.20 / 3600.0}   # league EV ixG per second, refit at each roll
LEAGUE_PSEUDO_G = 500.0
MIN_FOLD = 1e-9


def ev_shots(xg: pd.DataFrame) -> pd.DataFrame:
    """Unblocked EV shots with a shooter from a ``bu.rapm.xg`` season frame (game_id, shooter_id, is_goal, xg)."""
    if xg is None or not len(xg):
        return pd.DataFrame(columns=["game_id", "player_id", "g", "x"])
    m = xg["strength"].isin(EV_STRENGTHS) & ~xg["empty_net_against"].astype("boolean").fillna(False)
    s = xg[m & xg["shooter_id"].notna() & xg["xg"].notna()]
    return pd.DataFrame({"game_id": s["game_id"].astype("int64").to_numpy(),
                         "player_id": s["shooter_id"].astype("int64").to_numpy(),
                         "g": s["is_goal"].astype("boolean").fillna(False).astype(float).to_numpy(),
                         "x": s["xg"].astype(float).to_numpy()})


def player_games(xg: pd.DataFrame, shares: pd.DataFrame) -> pd.DataFrame:
    """(game_id, player_id, g, x, s): EV goals, xG and seconds per player and game.

    ``shares``: ``bu.lineup.toi.game_shares`` of the season's stints (EV seconds per game)."""
    sh = ev_shots(xg).groupby(["game_id", "player_id"], as_index=False)[["g", "x"]].sum()
    t = shares[["game_id", "player_id", "ev_s"]].rename(columns={"ev_s": "s"})
    pg = t.merge(sh, on=["game_id", "player_id"], how="outer")
    pg[["g", "x", "s"]] = pg[["g", "x", "s"]].astype(float).fillna(0.0)
    return pg


class FinState:
    """Point-in-time finishing state: decayed sums of completed seasons + this season so far."""

    def __init__(self, prior_xg: float = PRIOR_XG, decay: float = DECAY):
        self.prior_xg = float(prior_xg)
        self.decay = float(decay)
        self.past: dict[int, list] = {}                       # pid -> [g, x (league-scaled), s]
        self.cur: dict[int, list] = defaultdict(lambda: [0.0, 0.0, 0.0])
        self.lg = [0.0, 0.0]                                   # this season's league EV goals, xG
        self.mu = dict(MU_DEFAULT)
        self.season: str | None = None

    # ------------------------------------------------------------------ updates
    def add_games(self, pg: pd.DataFrame) -> None:
        """Fold player-game rows (columns player_id, g, x, s) of newly available games in."""
        if not len(pg):
            return
        agg = pg.groupby("player_id")[["g", "x", "s"]].sum()
        for pid, g, x, s in zip(agg.index, agg["g"], agg["x"], agg["s"]):
            c = self.cur[int(pid)]
            c[0] += g; c[1] += x; c[2] += s  # noqa: E702
        self.lg[0] += float(pg["g"].sum())
        self.lg[1] += float(pg["x"].sum())

    def ratio(self) -> float:
        """League goals per xG this season so far (shrunk to 1)."""
        return (self.lg[0] + LEAGUE_PSEUDO_G) / (self.lg[1] + LEAGUE_PSEUDO_G)

    def roll(self, season: str, groups: dict | None = None) -> None:
        """Season boundary: decay the past, fold the finished season in at its league ratio."""
        if self.season is not None and str(season) != self.season:
            r = self.lg[0] / self.lg[1] if self.lg[1] > 0 else 1.0
            d = self.decay
            new = {p: [v[0] * d, v[1] * d, v[2] * d] for p, v in self.past.items()}
            for p, c in self.cur.items():
                v = new.setdefault(p, [0.0, 0.0, 0.0])
                v[0] += c[0]; v[1] += c[1] * r; v[2] += c[2]  # noqa: E702
            self.past = {p: v for p, v in new.items() if v[2] > MIN_FOLD or v[1] > MIN_FOLD}
            if groups:
                self._refit_mu(groups)
            self.cur = defaultdict(lambda: [0.0, 0.0, 0.0])
            self.lg = [0.0, 0.0]
        self.season = str(season)

    def _refit_mu(self, groups: dict) -> None:
        tot = {"F": [0.0, 0.0], "D": [0.0, 0.0]}
        for p, v in self.past.items():
            g = "D" if groups.get(p) == "D" else "F"
            tot[g][0] += v[1]
            tot[g][1] += v[2]
        for g, (x, s) in tot.items():
            if s > 3600 * 100:
                self.mu[g] = x / s

    # ------------------------------------------------------------------ reads
    def sums(self, pid: int) -> tuple[float, float, float]:
        p = self.past.get(int(pid), (0.0, 0.0, 0.0))
        c = self.cur.get(int(pid), (0.0, 0.0, 0.0))
        r = self.ratio()
        return p[0] + c[0], p[1] + c[1] * r, p[2] + c[2]

    def multiplier(self, pid: int) -> float:
        g, x, _ = self.sums(pid)
        return (g + self.prior_xg) / (x + self.prior_xg)

    def fin(self, pid: int, group: str = "F") -> float:
        """Goals above xG per 60 of EV time (0 for a player with no data)."""
        g, x, s = self.sums(pid)
        mu = self.mu["D" if group == "D" else "F"]
        vol = (x + VOL_PSEUDO_S * mu) / (s + VOL_PSEUDO_S) * 3600.0
        return ((g + self.prior_xg) / (x + self.prior_xg) - 1.0) * vol

    def table(self, groups: dict | None = None) -> pd.DataFrame:
        groups = groups or {}
        pids = sorted(set(self.past) | set(self.cur))
        rows = []
        for p in pids:
            g, x, s = self.sums(p)
            rows.append((p, g, x, s, self.multiplier(p), self.fin(p, groups.get(p, "F"))))
        return pd.DataFrame(rows, columns=["player_id", "g_w", "xg_w", "ev_s_w", "mult", "fin"])

    # ------------------------------------------------------------------ persistence (season packs)
    def to_json(self) -> dict:
        return {"prior_xg": self.prior_xg, "decay": self.decay, "season": self.season, "mu": self.mu,
                "past": {"columns": ["player_id", "g", "x", "s"],
                         "rows": [[int(p), round(v[0], 6), round(v[1], 6), round(v[2], 3)]
                                  for p, v in sorted(self.past.items())]}}

    @classmethod
    def from_json(cls, j: dict) -> "FinState":
        st = cls(j["prior_xg"], j["decay"])
        st.season = j.get("season")
        st.mu = {k: float(v) for k, v in (j.get("mu") or MU_DEFAULT).items()}
        st.past = {int(r[0]): [float(r[1]), float(r[2]), float(r[3])] for r in j["past"]["rows"]}
        return st


# ---------------------------------------------------------------------- data

def season_player_games(paths, season: str, source: str) -> pd.DataFrame:
    """Player-game rows of one season with game dates (from the RAPM xG / stints caches)."""
    from bu.lake.build import read_table
    from bu.lineup.toi import game_shares
    from .data import ensure_stints, ensure_xg
    pg = player_games(ensure_xg(paths, season, source), game_shares(ensure_stints(paths, season, source)))
    g = read_table(paths.lake, "games", [season], columns=["game_id", "game_date", "game_type"])
    g = g[g["game_type"].isin([2, 3])]
    pg = pg.merge(g[["game_id", "game_date"]], on="game_id")
    pg["d"] = pd.to_datetime(pg["game_date"]).values.astype("datetime64[D]")
    return pg.sort_values(["d", "game_id"]).reset_index(drop=True)


def season_shots(paths, season: str, source: str) -> pd.DataFrame:
    from bu.lake.build import read_table
    from .data import ensure_xg
    s = ev_shots(ensure_xg(paths, season, source))
    g = read_table(paths.lake, "games", [season], columns=["game_id", "game_date", "game_type"])
    g = g[g["game_type"].isin([2, 3])]
    s = s.merge(g[["game_id", "game_date"]], on="game_id")
    s["d"] = pd.to_datetime(s["game_date"]).values.astype("datetime64[D]")
    return s


# ---------------------------------------------------------------------- validation

def _ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def evaluate_shots(paths, seasons: list[str], source: str, grid, score_seasons, groups=None,
                   lag_days: int = 2, log=print) -> pd.DataFrame:
    """Per (prior_xg, decay, season): mean shot log loss of xG x point-in-time multiplier minus
    xG alone (negative = finishing helps), with a game-clustered SE.  Every state replays all
    ``seasons`` in order (the first ones are burn-in)."""
    states = {(a, d): FinState(a, d) for a, d in grid}
    rows = []
    for S in seasons:
        pg = season_player_games(paths, S, source)
        sh = season_shots(paths, S, source) if S in score_seasons else None
        for st in states.values():
            st.roll(S, groups)
        avail = pg["d"].to_numpy() + np.timedelta64(lag_days, "D")   # usable from this date on
        ptr = 0
        cells = {k: [] for k in states}
        if sh is not None:
            for d, day in sh.groupby("d", sort=True):
                hi = int(np.searchsorted(avail, d, side="right"))
                if hi > ptr:
                    chunk = pg.iloc[ptr:hi]
                    for st in states.values():
                        st.add_games(chunk)
                    ptr = hi
                y, x, pid = day["g"].to_numpy(), day["x"].to_numpy(), day["player_id"].to_numpy()
                base = _ll(y, x)
                for k, st in states.items():
                    m = np.array([st.multiplier(p) for p in pid])
                    cells[k].append(pd.DataFrame({"game_id": day["game_id"].to_numpy(), "d": _ll(y, x * m) - base}))
        if ptr < len(pg):
            for st in states.values():
                st.add_games(pg.iloc[ptr:])
        if sh is not None:
            for (a, dc), parts in cells.items():
                c = pd.concat(parts)
                by_g = c.groupby("game_id")["d"].sum()
                n = len(c)
                rows.append({"prior_xg": a, "decay": dc, "season": S, "n_shots": n, "n_games": len(by_g),
                             "delta_ll_per_shot": float(c["d"].mean()),
                             "se": float(math.sqrt(len(by_g)) * by_g.std(ddof=1) / n)})
        log(f"  [fin] {S}: {len(pg):,} player-games" + (f", {len(sh):,} shots scored" if sh is not None else ""))
    return pd.DataFrame(rows)


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, default=float)


# ---------------------------------------------------------------------- season pack (live export)

def pack_path(season: str) -> str:
    from bu.lineup.evaluate import OUT_DIR
    return os.path.join(OUT_DIR, f"fin_pack_{season}.json.gz")


def build_pack(paths, season: str, source: str, groups: dict | None = None, log=print) -> dict:
    """FinState rolled to the start of ``season`` from every earlier lake season (full lake, once
    per season next to the lineup season pack); the live export adds this season's games."""
    from .data import lake_seasons
    st = FinState()
    for s in [x for x in lake_seasons(paths.lake) if x < str(season)]:
        st.roll(s, groups)
        st.add_games(season_player_games(paths, s, source))
        log(f"  [fin] {s}: folded")
    st.roll(str(season), groups)
    return {"version": 1, "kind": "fin_pack", "season": str(season),
            "xg_source": os.path.basename(os.path.normpath(source)), "state": st.to_json()}


def write_pack(path: str, payload: dict) -> str:
    import gzip
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with gzip.open(path + ".tmp", "wt") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return path


def read_pack(path: str) -> FinState | None:
    import gzip
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as f:
        return FinState.from_json(json.load(f)["state"])


def season_state(season: str, xg: pd.DataFrame | None, stints: pd.DataFrame | None,
                 pack: str | None = None) -> tuple[FinState | None, int]:
    """(FinState now, this season's games counted): the season's ``fin_pack`` (every earlier
    season) plus the season's games in the RAPM caches (``xg``: the shooter's goals and xG,
    ``stints``: EV time; regular season + playoffs).  (None, 0) without a pack for the season.
    Shared by the serving bundle (``bu.lineup.serve``) and the site ratings export."""
    st = read_pack(pack or pack_path(season))
    if st is None:
        return None, 0
    st.roll(str(season))
    if xg is None or stints is None or not len(stints):
        return st, 0
    from bu.lineup.toi import game_shares
    if "game_type" in stints.columns:
        stints = stints[stints["game_type"].isin([2, 3])]
    ids = set(stints["game_id"])
    st.add_games(player_games(xg[xg["game_id"].isin(ids)], game_shares(stints)))
    return st, len(ids)


def bundle_rows(st: FinState) -> list:
    """``[player_id, fin as a forward, fin as a defenceman]`` for every player with FIN data (the
    position group only sets the volume prior); a player not listed has FIN 0, as in ``FinState``."""
    out = []
    for p in sorted(set(st.past) | set(st.cur)):
        out.append([int(p), round(st.fin(p, "F"), 6) + 0.0, round(st.fin(p, "D"), 6) + 0.0])
    return out


def main(argv=None) -> int:
    import argparse
    import sys
    from bu.lake.paths import Lake
    from .paths import RapmPaths
    ap = argparse.ArgumentParser(prog="python -m bu.rapm.finishing")
    ap.add_argument("command", choices=["pack"])
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--out", default=None, help="RAPM state dir (xG / stints caches)")
    ap.add_argument("--xg", required=True, help="xG source key of the caches (as passed to bu.rapm)")
    ap.add_argument("--season", required=True)
    a = ap.parse_args(argv)
    paths = RapmPaths(Lake(a.lake_dir), a.out)
    from .__main__ import _players
    from .data import lake_seasons
    pl = _players(paths, lake_seasons(paths.lake))
    groups = dict(zip(pl["player_id"].astype(int), pl["pos_group"]))
    p = write_pack(pack_path(a.season), build_pack(paths, a.season, a.xg, groups))
    print(f"  [fin] pack -> {p}", file=sys.stdout)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
