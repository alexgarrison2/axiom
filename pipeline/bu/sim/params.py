"""The simulator's fitted parameters (``out/sim_params.json``, committed).

Written by ``python -m bu.sim.fit`` / ``python -m bu.sim.validate``; read by the engine and the
live path.  Sections: ``structural`` (state ratios, score effects, pulls, penalties, OT/SO),
``state`` (point-in-time hyper-parameters), ``glm`` (per-game rate regressions), ``dispersion``
(pace / team shocks), ``anchor`` (the dev-chosen variant), ``lineup`` (the lineup source the
regressions were fitted on, ``lineup_source.py``; absent = RAPM v2).  ``PONYXG_SIM_PARAMS``
points every reader and writer at another parameter file (e.g. a re-fit on new ratings);
``PONYXG_SIM_INPUTS=<name>`` (repository variable, the rollback switch of a lineup-input
promotion) selects the committed ``out/sim_params_<name>.json`` (e.g. ``v2``: the simulator on
RAPM v2 inputs, kept when ratings v4 became its inputs); an unknown name is ignored (logged)."""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
PARAMS_PATH = os.path.join(OUT_DIR, "sim_params.json")
PARAMS_ENV = "PONYXG_SIM_PARAMS"      # alternative parameter file (a re-fit on a new lineup source)
INPUTS_ENV = "PONYXG_SIM_INPUTS"      # committed alternative by name: out/sim_params_<name>.json
STATE_PACK = os.path.join(OUT_DIR, "sim_state_{season}.json.gz")


def params_path() -> str:
    if os.environ.get(PARAMS_ENV):
        return os.environ[PARAMS_ENV]
    name = (os.environ.get(INPUTS_ENV) or "").strip().lower()
    if name:
        alt = os.path.join(OUT_DIR, f"sim_params_{name}.json")
        if name.replace("_", "").isalnum() and os.path.exists(alt):
            return alt
        print(f"[sim] {INPUTS_ENV}={name!r}: no {os.path.basename(alt)}; using sim_params.json")
    return PARAMS_PATH


def load_params(path: str | None = None, missing_ok: bool = False) -> dict | None:
    path = path or params_path()
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        if missing_ok:
            return None
        raise


def save_params(p: dict, path: str | None = None) -> str:
    path = path or params_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(p, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    return path


def state_pack_path(season: str) -> str:
    return STATE_PACK.format(season=season)
