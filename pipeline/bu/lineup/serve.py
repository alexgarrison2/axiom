"""Live lineup term: season pack, serving bundle and scorer (DESIGN §3.2.2 live wiring, §3.7).

The backtest feature table (``features.build``) replays every lake season.  The live site
cannot: CI has no historical lake.  So the state is cut in two small JSON files:

``season_pack_<S>.json.gz`` (committed, built once per season from the full lake)
    the RAPM chain at the start of season S (``bu.rapm.pack``: carried posteriors, aging
    curve, rookie means, sigma2, covariates, bio) plus the lineup-side state after every game
    before S: the EV TOI share state (``toi.ShareState``) and each team's last 10 dressed
    lineups (the ``delta`` baseline).

``serving_bundle.json.gz`` (rebuilt by each refresh)
    the pack rolled forward through the season's games available now: current ratings
    (``ratings/latest_season=S`` from ``python -m bu.rapm asof --seed <pack>``; the season
    prior for every carried player who has not played yet), share state, team histories,
    the fitted intercept and home term, rookie means and the NHL-id crosswalk for DailyFaceoff
    names.  ``built_at`` drives the DESIGN §3.2.2 freshness rule.

``LiveLineupTerm.features(home, away, dfo_home, dfo_away)`` turns tonight's DFO projected
lines (minus out / IR / suspended) into ``bu_d_net``, ``bu_d_delta`` and ``bu_d_fin`` with exactly
the per-team arithmetic of the backtest (``features.side_term``).  ``bu_d_fin`` reads the
bundle's ``fin`` table: each player's FIN (``bu.rapm.finishing``) from the season's committed
``fin_pack_<S>.json.gz`` plus the season's games in the refresh's RAPM caches; a player not in
it has FIN 0, as in the backtest.  A bundle without a ``fin`` table (older code, no fin pack for
the season) gives ``fin_ok = False``: a model that uses ``bu_d_fin`` is then not served with a
zero-filled FIN (``ml_predict.MLPredictor.bu_features``).  It never raises on bad input:
a stale bundle (older than ``MAX_AGE_H``), an unknown team or fewer than ``MIN_RATED`` mapped
and rated skaters on either side gives ``bu_ok = False`` and neutral (0) model features, the
same policy the walk-forward used (``evaluate.attach``).

Refresh (from ``pipeline/``; the lake needs only the current season's partition):

    python -m bu.lake.backfill --seasons 2026            # current season PBP + shifts
    python -m bu.rapm asof --seasons 2026 --seed bu/lineup/out/season_pack_20262027.json.gz
    python -m bu.lineup serve --season 20262027 --seed bu/lineup/out/season_pack_20262027.json.gz
"""
from __future__ import annotations

import gzip
import json
import os
from collections import defaultdict, deque
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.rapm import pack as rpack
from bu.rapm.data import cached_stints, lake_seasons
from bu.rapm.design import COVARIATES, Index
from .crosswalk import Resolver, dfo_skaters
from .features import BASELINE_GAMES, MIN_RATED, lineup_tables, side_term
from .toi import ShareState, game_shares

BUNDLE_VERSION = 1
MAX_AGE_H = 36.0
RAPM_COLUMNS = ("bu_d_net", "bu_d_delta")   # the dev-selected candidate (lineup_eval.json)
FIN_COLUMNS = ("bu_d_fin",)                 # retrain.py --fin (retrain_fin.json)
LIVE_COLUMNS = RAPM_COLUMNS + FIN_COLUMNS
MIN_SKATERS = 10


# ----------------------------------------------------------------------- lake replay helpers

def season_shares(paths, seasons, games: pd.DataFrame) -> pd.DataFrame:
    frames = []
    for s in seasons:
        sh = game_shares(cached_stints(paths, s))
        if len(sh):
            frames.append(sh.assign(season=s))
    if not frames:
        return pd.DataFrame(columns=["game_id", "player_id", "ev_s", "share", "season", "d"])
    sh = pd.concat(frames, ignore_index=True).merge(games[["game_id", "d"]], on="game_id")
    return sh.sort_values(["d", "game_id"], kind="stable").reset_index(drop=True)


def replay(state: ShareState, history, shares: pd.DataFrame, games: pd.DataFrame, lineups: dict,
           pos_group: dict) -> None:
    """Apply every share row and every dressed lineup (>= MIN_SKATERS) in date order."""
    for s, sub in shares.groupby("season", sort=True):
        state.apply(sub, pos_group, s)
    for g in games.itertuples(index=False):
        for tid in (int(g.home_team_id), int(g.away_team_id)):
            lp = lineups.get((int(g.game_id), tid))
            if lp and len(lp[0]) >= MIN_SKATERS:
                history[tid].append(lp)


def _state_json(state: ShareState) -> dict:
    return {"columns": ["player_id", "s", "w", "last", "season"],
            "rows": [[int(p), float(state.s[p]), float(state.w[p]), float(state.last.get(p, np.nan)),
                      str(state.season.get(p, ""))] for p in state.s],
            "first_sum": dict(state.first_sum), "first_n": dict(state.first_n)}


def _state_from_json(j: dict) -> ShareState:
    st = ShareState()
    for p, s, w, last, season in j["rows"]:
        st.s[int(p)], st.w[int(p)], st.season[int(p)] = float(s), float(w), str(season)
        if last is not None and np.isfinite(last):
            st.last[int(p)] = float(last)
    st.first_sum = {k: float(v) for k, v in j["first_sum"].items()}
    st.first_n = {k: int(v) for k, v in j["first_n"].items()}
    return st


def _history_json(history) -> dict:
    return {str(t): [[list(map(int, p)), list(g)] for p, g in dq] for t, dq in history.items()}


def _history_from_json(j: dict):
    h = defaultdict(lambda: deque(maxlen=BASELINE_GAMES))
    for t, items in (j or {}).items():
        for p, g in items:
            h[int(t)].append(([int(x) for x in p], list(g)))
    return h


def _write(path, payload) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


def _read(path) -> dict:
    with gzip.open(path, "rt") as f:
        return json.load(f)


# ----------------------------------------------------------------------- season pack

def build_season_pack(paths, season: str) -> dict:
    """RAPM prior pack of ``season`` (written by ``bu.rapm asof``) + the lineup state after every
    lake game of earlier seasons."""
    p = rpack_path(paths, season)
    if not os.path.exists(p):
        raise SystemExit(f"no RAPM prior pack for {season} at {p}: run `python -m bu.rapm asof` through {season}")
    earlier = [s for s in lake_seasons(paths.lake) if s < str(season)]
    games, lineups, pos_group = lineup_tables(paths.lake, earlier)
    state, history = ShareState(), defaultdict(lambda: deque(maxlen=BASELINE_GAMES))
    if len(games):
        replay(state, history, season_shares(paths, earlier, games), games, lineups, pos_group)
    return {"version": BUNDLE_VERSION, "kind": "season_pack", "season": str(season),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lake_seasons": earlier, "rapm": rpack.read(p),
            "shares": _state_json(state), "history": _history_json(history),
            "teams": team_ids_from_lake(paths.lake, earlier[-1:]) if earlier else {},
            "first_pos_group": {str(k): v for k, v in pos_group.items()}}


def rpack_path(paths, season) -> str:
    return os.path.join(paths.root, "prior_pack", f"season={season}.json.gz")


# ----------------------------------------------------------------------- serving bundle

def latest_paths(paths, season) -> tuple[str, str]:
    d = os.path.dirname(paths.ratings(season))
    return os.path.join(d, f"latest_season={season}.parquet"), os.path.join(d, f"latest_season={season}.json")


def _ratings_table(paths, season, seed: rpack.Seed) -> tuple[pd.DataFrame, dict, str | None]:
    """(player_id, o, d, rated) for the bundle, covariates {name: value}, max_source_date."""
    p, meta_p = latest_paths(paths, season)
    if os.path.exists(p) and os.path.exists(meta_p):
        r = pd.read_parquet(p)
        with open(meta_p) as f:
            meta = json.load(f)
        r["rated"] = (~r["is_new"].astype(bool)) | (r["ev_toi_s"] > 0)
        return r[["player_id", "o", "d", "rated"]], meta["covariates"], meta.get("max_source_date")
    # no game of the season yet: the season prior of every carried player
    idx = Index(sorted(seed.chain.state))
    b0, _lam, is_new = seed.chain.prior(season, idx, seed.players(), seed.aging, seed.rookie)
    n = idx.n
    r = pd.DataFrame({"player_id": idx.ids, "o": b0[:n], "d": b0[n:2 * n], "rated": ~is_new})
    return r, {c: float(v) for c, v in zip(COVARIATES, b0[2 * n:])}, None


def build_bundle(paths, season: str, seed_path: str, *, crosswalk: pd.DataFrame | None = None,
                 now: datetime | None = None) -> dict:
    """Roll the season pack forward through the season's lake games and attach current ratings."""
    sp = _read(seed_path)
    if str(sp["season"]) != str(season):
        raise SystemExit(f"season pack is for {sp['season']}, not {season}")
    seed = rpack.Seed(sp["rapm"])
    state = _state_from_json(sp["shares"])
    history = _history_from_json(sp["history"])
    pos_group = {int(k): v for k, v in (sp.get("first_pos_group") or {}).items()}
    have = str(season) in lake_seasons(paths.lake)
    games, lineups, pg_now = lineup_tables(paths.lake, [season]) if have else (pd.DataFrame(), {}, {})
    for k, v in pg_now.items():
        pos_group.setdefault(k, v)
    if len(games):
        replay(state, history, season_shares(paths, [season], games), games, lineups, pos_group)
    ratings, cov, src = _ratings_table(paths, season, seed)
    fin = fin_table(paths, season)
    v3 = v3_table(paths, season)
    v4 = v4_table(paths, season)
    prod = prod_table(paths, season, v4)
    means = seed.rookie.means
    rookie = {g: [means.get((g, "all", "o"), 0.0), means.get((g, "all", "d"), 0.0)] for g in ("F", "D")}
    teams = {}
    if len(games):
        for a, t in list(zip(games["home_abbrev"], games["home_team_id"])) + list(zip(games["away_abbrev"],
                                                                                    games["away_team_id"])):
            teams[str(a)] = int(t)
    now = now or datetime.now(timezone.utc)
    out = {"version": BUNDLE_VERSION, "kind": "serving_bundle", "season": str(season),
           "built_at": now.isoformat(timespec="seconds"), "max_source_date": src,
           "n_games": int(len(games)), "hyper": seed.hyper.as_dict(),
           "columns": list(RAPM_COLUMNS) + (list(FIN_COLUMNS) if fin is not None else []),
           "covariates": {"intercept": float(cov.get("intercept", np.nan)), "home": float(cov.get("home", np.nan))},
           "rookie": rookie,
           "players": {"columns": ["player_id", "o", "d", "rated"],
                       "rows": [[int(p), float(o), float(d), bool(rt)] for p, o, d, rt in
                                ratings[["player_id", "o", "d", "rated"]].itertuples(index=False)]},
           "shares": _state_json(state), "history": _history_json(history),
           "teams": {**sp.get("teams", {}), **teams},
           "fin": fin,
           "v3": v3,
           "v4": v4,
           "prod": prod,
           "crosswalk": None}
    if crosswalk is not None and len(crosswalk):
        cols = ["player_id", "norm", "last", "team", "sweater", "rank"]
        cw = crosswalk[cols].copy()
        cw["sweater"] = pd.to_numeric(cw["sweater"], errors="coerce")
        out["crosswalk"] = {"columns": cols, "rows": [[int(p), n, la, t, None if pd.isna(s) else int(s), int(r)]
                                                      for p, n, la, t, s, r in cw.itertuples(index=False)]}
    return out


def fin_table(paths, season: str, pack: str | None = None) -> dict | None:
    """The bundle's ``fin`` table (``bu.rapm.finishing.season_state``): the committed season
    ``fin_pack`` plus this season's games in the RAPM caches (``bu.rapm asof`` writes them);
    None without a fin pack for the season (the FIN term is then unavailable)."""
    from bu.rapm import finishing as FN
    xp, sp = paths.xg(season), paths.stints(season)
    have = os.path.exists(xp) and os.path.exists(sp)
    st, n = FN.season_state(season, pd.read_parquet(xp) if have else None,
                            pd.read_parquet(sp) if have else None, pack=pack)
    if st is None:
        return None
    return {"pack": os.path.basename(pack or FN.pack_path(season)), "season_games": int(n),
            "prior_xg": st.prior_xg, "columns": ["player_id", "fin_f", "fin_d"], "rows": FN.bundle_rows(st)}


def v3_table(paths, season: str, pack: str | None = None) -> dict | None:
    """The bundle's ``v3`` table: player ratings v3 (``bu.rapm.v3_pack.bundle_table``: the committed
    ``ratings_pack_<S>.json.gz`` rolled through the season's games in the refresh's caches), the
    source of the site's ``player_ratings.json``; None without a ratings pack for the season.
    Never raises: a failure leaves the v2 term untouched (the export then keeps its last file)."""
    try:
        from bu.rapm import v3_pack as P3
        return P3.bundle_table(paths, season, pack_file=pack)
    except Exception as e:  # noqa: BLE001
        print(f"  [serve] v3 ratings table failed: {type(e).__name__}: {e}")
        return None


def v4_table(paths, season: str, pack: str | None = None) -> dict | None:
    """The bundle's ``v4`` table: player ratings v4 (``bu.rapm.v4_pack.bundle_table``: v3's columns plus
    the box-score priors ``spm_o`` / ``spm_d`` / ``spm_pp`` / ``spm_pk`` and the penalty rates ``pd60`` /
    ``pt60``; ``meta.pen_value`` goals per penalty unit), the source of the site's ``player_ratings.json``
    (version 4) and of the game simulator's player ratings; None without a v4 ratings pack (the export
    then falls back to the ``v3`` table).  Never raises."""
    try:
        from bu.rapm import v4_pack as P4
        return P4.bundle_table(paths, season, pack_file=pack)
    except Exception as e:  # noqa: BLE001
        print(f"  [serve] v4 ratings table failed: {type(e).__name__}: {e}")
        return None


def prod_table(paths, season: str, v4: dict | None = None, pack: str | None = None) -> dict | None:
    """The bundle's ``prod`` table: recency-weighted Game Score sums (``bu.rapm.prod.bundle_table``: the
    committed ``prod_pack_<S>.json.gz`` plus this season's lake games) as of the ``v4`` table's ``asof`` /
    ``g``; the source of ``player_ratings.json``'s descriptive ``prod`` / ``gs_pg``.  Never raises."""
    try:
        from bu.rapm import prod as PR
        meta = (v4 or {}).get("meta") or {}
        return PR.bundle_table(paths, season, asof=meta.get("asof"), g=meta.get("g"), pack_file=pack)
    except Exception as e:  # noqa: BLE001
        print(f"  [serve] prod table failed: {type(e).__name__}: {e}")
        return None


def team_ids_from_lake(lake, seasons) -> dict:
    g = read_table(lake, "games", seasons, columns=["home_abbrev", "home_team_id"])
    if g.empty:
        return {}
    return {str(a): int(t) for a, t in zip(g["home_abbrev"], g["home_team_id"])}


# ----------------------------------------------------------------------- live scorer

class LiveLineupTerm:
    """Tonight's lineup term from a serving bundle (see module docstring)."""

    def __init__(self, bundle: dict, max_age_h: float = MAX_AGE_H, ratings: str = "v2"):
        """``ratings``: the player ratings the model was trained on (game_model_meta.json
        ``bu_lineup.ratings``): 'v2' = the bundle's ``players`` / ``rookie`` / ``fin`` tables (RAPM v2),
        'v3' / 'v4' = the bundle's ``v3`` / ``v4`` table (o, d, rated, fin; rookies at its
        ``meta.low_role``), the same ratings the walk-forward feature table was built from."""
        if int(bundle.get("version", 0)) != BUNDLE_VERSION or bundle.get("kind") != "serving_bundle":
            raise ValueError("not a serving bundle of version %s" % BUNDLE_VERSION)
        self.b = bundle
        self.max_age_h = float(max_age_h)
        self.built_at = datetime.fromisoformat(bundle["built_at"])
        self.ratings_source = str(ratings or "v2")
        rt = None
        if self.ratings_source != "v2":
            rt = bundle.get(self.ratings_source)
            if not rt or not isinstance(rt.get("rows"), list) or not rt["rows"]:
                raise ValueError(f"the bundle has no {self.ratings_source} ratings table")
        if rt is None:
            cols = bundle["players"]["columns"]
            self.ratings = {int(r[0]): (float(r[cols.index("o")]), float(r[cols.index("d")]),
                                        bool(r[cols.index("rated")])) for r in bundle["players"]["rows"]}
            self.rookie = {g: tuple(v) for g, v in bundle["rookie"].items()}
        else:
            cols = rt["columns"]
            io, id_, ir = cols.index("o"), cols.index("d"), cols.index("rated")
            self.ratings = {int(r[0]): (float(r[io]), float(r[id_]), bool(r[ir])) for r in rt["rows"]}
            low = (rt.get("meta") or {}).get("low_role") or {}
            self.rookie = {g: (float(v[0]), float(v[1])) for g, v in low.items()} or \
                {g: tuple(v) for g, v in bundle["rookie"].items()}
        self.state = _state_from_json(bundle["shares"])
        self.history = _history_from_json(bundle["history"])
        self.teams = {str(k): int(v) for k, v in (bundle.get("teams") or {}).items()}
        fin = bundle.get("fin") or {}
        self.fin = ({int(r[0]): (float(r[1]), float(r[2])) for r in fin["rows"]}
                    if isinstance(fin.get("rows"), list) and "bu_d_fin" in (bundle.get("columns") or []) else None)
        if rt is not None and "fin" in rt["columns"] and "bu_d_fin" in (bundle.get("columns") or []):
            jf = rt["columns"].index("fin")       # v3 / v4: FIN at the player's own position group
            self.fin = {int(r[0]): (float(r[jf]), float(r[jf])) for r in rt["rows"]}
        # the lineup term's intercept c0 (league 5v5 xGF/60 of an average lineup; the game simulator's
        # log((c0 + OFF + DEF) / c0)): the ratings table's own EV intercept when it records one, else
        # the bundle's RAPM v2 covariate
        cov0 = (bundle.get("covariates") or {}).get("intercept")
        ti = ((rt or {}).get("meta") or {}).get("intercept")
        self.intercept = float(ti) if ti is not None else (float(cov0) if cov0 is not None else None)
        cw = bundle.get("crosswalk")
        self.resolver = Resolver(pd.DataFrame(cw["rows"], columns=cw["columns"])) if cw else None
        # player special teams / penalties of the ratings table (v4: pp, pk, expected minutes, v5 penalty
        # rates), aggregated per side for the game simulator (bu.sim.st_lineup, prereg_st.json)
        self.st_lookup, self.st_fb = None, None
        from bu.sim.st_lineup import PLAYER_COLS, fallbacks
        if rt is not None and all(c in rt["columns"] for c in PLAYER_COLS):
            try:
                tab = pd.DataFrame(rt["rows"], columns=rt["columns"])
                self.st_lookup = {int(p): tuple(float(v) for v in vals) for p, *vals in
                                  tab[["player_id", *PLAYER_COLS]].itertuples(index=False, name=None)}
                meta = rt.get("meta") or {}
                low = meta.get("low_role") or {}
                role = {g: (float(v[2]), float(v[3])) for g, v in low.items() if len(v) >= 4} or None
                self.st_fb = fallbacks(tab, role, meta.get("toi_pos_means"), None)
            except Exception as e:  # noqa: BLE001  (the 5v5 term is unaffected)
                print(f"  [serve] player special teams unavailable: {type(e).__name__}: {e}")
                self.st_lookup, self.st_fb = None, None

    @classmethod
    def load(cls, path: str, **kw) -> "LiveLineupTerm":
        return cls(_read(path), **kw)

    def age_hours(self, now: datetime | None = None) -> float:
        now = now or datetime.now(timezone.utc)
        return (now - self.built_at).total_seconds() / 3600.0

    def _rate(self, pids, groups):
        o, d, rated = [], [], 0
        for p, g in zip(pids, groups):
            if p in self.ratings:
                a, b, r = self.ratings[p]
            else:
                (a, b), r = self.rookie.get(g, (0.0, 0.0)), False
            o.append(a); d.append(b); rated += int(r)  # noqa: E702
        return np.array(o), np.array(d), rated

    def _fin(self, pids, groups):
        return [self.fin.get(int(p), (0.0, 0.0))[1 if g == "D" else 0] for p, g in zip(pids, groups)]

    @property
    def fin_ok(self) -> bool:
        return self.fin is not None

    def resolve(self, team: str, dfo_team: dict | None) -> tuple[list, list, list]:
        """DFO projected skaters (minus out / IR / suspended) -> (pids, groups, unmapped names)."""
        pids, groups, unmapped = [], [], []
        for p in dfo_skaters({team: dfo_team or {}}, team):
            pid = None
            if self.resolver is not None:
                pid, _how = self.resolver.resolve(team, p["name"], p["number"])
            if pid is None:
                unmapped.append(p["name"])
            elif pid not in pids:
                pids.append(int(pid)); groups.append(p["group"])  # noqa: E702
        return pids, groups, unmapped

    def side(self, team: str, pids, groups) -> dict:
        tid = self.teams.get(team)
        past = list(self.history.get(tid, ())) if tid is not None else []
        t = side_term(self.state, pids, groups, self._rate, past, fin=self._fin if self.fin_ok else None)
        out = {"team": team, "n": len(pids), **t}
        if self.st_lookup is not None:
            from bu.sim.st_lineup import aggregate
            out["st"] = aggregate(self.st_lookup, pids, groups, self.st_fb)
        return out

    def features(self, home: str, away: str, dfo_home: dict | None, dfo_away: dict | None,
                 now: datetime | None = None, ids_home=None, ids_away=None) -> dict:
        """Model features (neutral when ``bu_ok`` is False) plus per-side detail.

        ``ids_home`` / ``ids_away``: optional already-resolved ``[(player_id, 'F'|'D'), ...]``
        lists that replace the DFO lookup (e.g. a confirmed boxscore lineup)."""
        out = {c: 0.0 for c in LIVE_COLUMNS}
        out.update({"bu_ok": False, "fin_ok": self.fin_ok, "reason": None, "bundle_built_at": self.b["built_at"],
                    "bundle_age_h": round(self.age_hours(now), 2), "home": None, "away": None})
        try:
            if out["bundle_age_h"] > self.max_age_h:
                out["reason"] = f"stale bundle ({out['bundle_age_h']:.0f} h > {self.max_age_h:.0f} h)"
                return out
            sides = {}
            for key, team, dfo, ids in (("home", home, dfo_home, ids_home), ("away", away, dfo_away, ids_away)):
                if ids is not None:
                    pids, groups, unmapped = [int(p) for p, _ in ids], [g for _, g in ids], []
                else:
                    pids, groups, unmapped = self.resolve(team, dfo)
                if len(pids) < MIN_SKATERS:
                    out[key] = {"team": team, "n": len(pids), "unmapped": unmapped}
                    out["reason"] = f"{team}: {len(pids)} mapped skaters"
                    return out
                s = self.side(team, pids, groups)
                s["unmapped"] = unmapped
                out[key] = sides[key] = s
            h, a = sides["home"], sides["away"]
            ok = h["rated"] >= MIN_RATED and a["rated"] >= MIN_RATED
            if not ok:
                out["reason"] = f"coverage: {h['rated']}/{a['rated']} rated (< {MIN_RATED})"
                return out
            out["bu_ok"] = True
            out["bu_d_net"] = float(h["net"] - a["net"])
            out["bu_d_delta"] = float(h["delta"] - a["delta"])
            if self.fin_ok:
                out["bu_d_fin"] = float(h["fin"] - a["fin"])
            return out
        except Exception as e:      # never break the prediction run
            out["reason"] = f"error: {e}"
            out["bu_ok"] = False
            for c in LIVE_COLUMNS:
                out[c] = 0.0
            return out


def write_bundle(path: str, bundle: dict) -> str:
    return _write(path, bundle)


def write_pack(path: str, pack: dict) -> str:
    return _write(path, pack)


def read(path: str) -> dict:
    return _read(path)
