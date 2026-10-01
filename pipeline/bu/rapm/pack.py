"""Season-start prior pack: the summer roll-forward state of season S in one small JSON.

``asof.run`` writes one per season (``<out>/prior_pack/season=S.json.gz``) just before the
season's prior is formed.  It holds everything ``Chain.prior`` needs, so the season can be
refit later *without replaying earlier seasons* (the live refresh in CI has the current
season's lake partition only):

  chain    per-player posterior carried from earlier seasons (o, d, o_var, d_var, last season),
           the residual variance ``sigma2`` and last season's covariates
  aging    the aging curve fitted on seasons < S
  rookie   the rookie means fitted on seasons < S
  bio      birth date / position group / draft slot / first season of every carried player
  hyper    the frozen hyper-parameters the chain was run with

Floats are written with Python's shortest round-trip repr, so a seeded refit reproduces the
full-chain ratings exactly (``tests/test_rapm.py::test_seeded_asof_matches_full_chain``).
"""
from __future__ import annotations

import gzip
import json
import os

import numpy as np
import pandas as pd

from .aging import AgingCurve
from .priors import Chain, Hyper, RookieModel

PACK_VERSION = 1
BIO_COLUMNS = ["player_id", "birth_date", "pos_group", "draft_overall", "first_season"]


def _f(x):
    x = float(x)
    return None if not np.isfinite(x) else x


def to_json(season: str, chain: Chain, aging: AgingCurve, rookie: RookieModel, players: pd.DataFrame) -> dict:
    st = chain.table()
    bio = players[players["player_id"].isin(st["player_id"])] if len(players) else players
    bio = bio.reindex(columns=BIO_COLUMNS)
    return {
        "version": PACK_VERSION, "season": str(season), "hyper": chain.h.as_dict(),
        "chain": {
            "sigma2": float(chain.sigma2),
            "cov_prev": None if chain.cov_prev is None else [float(v) for v in chain.cov_prev],
            "columns": ["player_id", "o", "d", "o_var", "d_var", "last_season"],
            "rows": [[int(p), float(o), float(d), float(ov), float(dv), str(ls)]
                     for p, o, d, ov, dv, ls in st.itertuples(index=False)],
        },
        "aging": aging.to_json(),
        "rookie": rookie.to_json(),
        "bio": {"columns": BIO_COLUMNS,
                "rows": [[int(r.player_id), None if pd.isna(r.birth_date) else str(r.birth_date),
                          None if pd.isna(r.pos_group) else str(r.pos_group), _f(r.draft_overall)
                          if not pd.isna(r.draft_overall) else None,
                          None if pd.isna(r.first_season) else int(r.first_season)]
                         for r in bio.itertuples(index=False)]},
    }


def write(path: str, payload: dict) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


def read(path: str) -> dict:
    with gzip.open(path, "rt") as f:
        return json.load(f)


class Seed:
    """A loaded pack: ``chain``, ``aging``, ``rookie``, ``bio`` for its ``season``."""

    def __init__(self, payload: dict):
        rp = payload.get("rapm", payload)        # a lineup season pack nests the RAPM part
        if int(rp.get("version", 0)) != PACK_VERSION:
            raise ValueError(f"prior pack version {rp.get('version')} != {PACK_VERSION}")
        self.season = str(rp["season"])
        self.hyper = Hyper(**rp["hyper"])
        ch = Chain(self.hyper)
        ch.sigma2 = float(rp["chain"]["sigma2"])
        cp = rp["chain"]["cov_prev"]
        ch.cov_prev = None if cp is None else np.array(cp, dtype=float)
        for p, o, d, ov, dv, ls in rp["chain"]["rows"]:
            ch.state[int(p)] = (float(o), float(d), float(ov), float(dv), str(ls))
        self.chain = ch
        self.aging = aging_from_json(rp["aging"])
        self.rookie = rookie_from_json(rp["rookie"])
        self.bio = pd.DataFrame(rp["bio"]["rows"], columns=rp["bio"]["columns"])
        if len(self.bio):
            self.bio["draft_overall"] = pd.to_numeric(self.bio["draft_overall"], errors="coerce")
            self.bio["first_season"] = pd.to_numeric(self.bio["first_season"], errors="coerce")

    @classmethod
    def load(cls, path: str) -> "Seed":
        return cls(read(path))

    def players(self, current: pd.DataFrame | None = None) -> pd.DataFrame:
        """The current season's bio table completed with the pack's bio (carried players
        who are missing from it, e.g. a returning player not yet in this season's payload)."""
        if current is None or not len(current):
            return self.bio.copy()
        extra = self.bio[~self.bio["player_id"].isin(current["player_id"])]
        return pd.concat([current, extra.reindex(columns=current.columns)], ignore_index=True)


def aging_from_json(j: dict) -> AgingCurve:
    c = AgingCurve(fit_seasons=list(j.get("fit_seasons", [])))
    for k, v in (j.get("coef") or {}).items():
        g, comp = k.split("_", 1)
        c.coef[(g, comp)] = np.array(v, dtype=float)
    for k, v in (j.get("n") or {}).items():
        g, comp = k.split("_", 1)
        c.n[(g, comp)] = int(v)
    return c


def rookie_from_json(j: dict) -> RookieModel:
    m = RookieModel(fit_seasons=list(j.get("fit_seasons", [])))
    for k, v in (j.get("means") or {}).items():
        g, tier, comp = k.split("|")
        m.means[(g, tier, comp)] = float(v)
    return m
