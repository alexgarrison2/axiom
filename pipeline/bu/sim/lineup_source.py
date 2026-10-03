"""The simulator's lineup inputs, pluggable (``params['lineup']``).

The rate regressions (``rates.py``) read three numbers per side from a player-ratings source:

  off  the dressed skaters' 5v5 offence, xGF/60 above the source's intercept (EV-TOI weighted)
  def  their 5v5 defence, xGA/60 allowed above the intercept (negative = prevents chances)
  fin  their finishing, goals above xG / 60 (EV-TOI weighted)

plus the intercept ``c_intercept`` (league 5v5 xGF/60 of an average lineup).  The 5v5 lineup
term is ``log((c0 + OFF_X + DEF_Y) / c0)``, so any ratings table on that scale plugs in.

A source is two artefacts with the same scale:

  history_table   one row per historical game, point in time (ratings as of d - 2 days):
                  game_id, bu_ok, c_intercept, bu_{h,a}_{off,def,fin} (``REQUIRED``)
  serving_bundle  a ``bu.lineup.serve.LiveLineupTerm`` bundle (tonight's DFO lines -> the same
                  per-side off / def / fin), read by the live path

Swapping in a new ratings table (e.g. ratings v4 with a production-based prior):

  1. write its history table and serving bundle in these formats;
  2. ``python -m bu.sim.fit glm --work W --lineup-table <csv> --lineup-bundle <json.gz>
     --lineup-name v4 --params-out <new params.json>``: rebuilds the point-in-time inputs with
     the new table and refits the four rate regressions on the fit seasons (structural tables,
     state hyper-parameters and dispersion are copied from the current parameters);
  3. score it: ``PONYXG_SIM_PARAMS=<new params.json> python -m bu.sim.validate ...`` / a new
     pre-registered comparison; promote by committing the new params as ``out/sim_params.json``.

Nothing else changes: ``SimServer`` loads the bundle named in the parameters when it differs
from the game model's own, so the simulator and the logit can run on different ratings.
"""
from __future__ import annotations

import os

import pandas as pd

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT = {
    "name": "rapm_v2",
    "history_table": "bu/lineup/out/lineup_features.csv.gz",
    "serving_bundle": "bu/lineup/out/serving_bundle.json.gz",
}
REQUIRED = ["game_id", "bu_ok", "c_intercept", "bu_h_off", "bu_h_def", "bu_a_off", "bu_a_def", "bu_h_fin",
            "bu_a_fin"]


def spec(params: dict | None) -> dict:
    """The lineup source of a parameter set (the RAPM v2 default when absent)."""
    return {**DEFAULT, **((params or {}).get("lineup") or {})}


def resolve(path: str) -> str:
    return path if os.path.isabs(path) else os.path.join(PIPELINE_DIR, path)


def history_table(source) -> pd.DataFrame:
    """Load and check a history table (``source``: a spec dict or a path)."""
    path = resolve(source["history_table"] if isinstance(source, dict) else source)
    f = pd.read_csv(path) if not path.endswith(".parquet") else pd.read_parquet(path)
    missing = [c for c in REQUIRED if c not in f.columns]
    if missing:
        raise ValueError(f"lineup table {path} lacks {missing}")
    f["bu_ok"] = f["bu_ok"].astype(str).str.lower().isin(("true", "1"))
    f["game_id"] = pd.to_numeric(f["game_id"], errors="coerce").astype("int64")
    keep = [c for c in f.columns if c == "game_id" or c.startswith("bu_") or c.startswith("c_")]
    return f[keep].drop_duplicates("game_id")


def live_term(source: dict, loaded: dict | None = None):
    """``LiveLineupTerm`` of the source's serving bundle (``loaded``: {abs path: term} already in
    memory, e.g. the game model's own), or None when it cannot be read."""
    path = resolve(source["serving_bundle"])
    if loaded and path in loaded:
        return loaded[path]
    try:
        from bu.lineup.serve import LiveLineupTerm
        return LiveLineupTerm.load(path)
    except Exception as e:      # missing bundle: every row falls back, flagged
        print(f"[sim] lineup source {source.get('name')}: bundle unavailable ({type(e).__name__}: {e})")
        return None


def history_inputs_name(params: dict | None) -> str:
    """File name of the point-in-time inputs built with the source (``fit glm``)."""
    name = spec(params)["name"]
    return "history_inputs.parquet" if name == DEFAULT["name"] else f"history_inputs_{name}.parquet"
