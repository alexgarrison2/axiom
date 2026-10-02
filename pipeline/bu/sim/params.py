"""The simulator's fitted parameters (``out/sim_params.json``, committed).

Written by ``python -m bu.sim.fit`` / ``python -m bu.sim.validate``; read by the engine and the
live path.  Sections: ``structural`` (state ratios, score effects, pulls, penalties, OT/SO),
``state`` (point-in-time hyper-parameters), ``glm`` (per-game rate regressions), ``dispersion``
(pace / team shocks), ``anchor`` (the dev-chosen variant)."""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
PARAMS_PATH = os.path.join(OUT_DIR, "sim_params.json")
STATE_PACK = os.path.join(OUT_DIR, "sim_state_{season}.json.gz")


def load_params(path: str = PARAMS_PATH, missing_ok: bool = False) -> dict | None:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        if missing_ok:
            return None
        raise


def save_params(p: dict, path: str = PARAMS_PATH) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(p, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    return path


def state_pack_path(season: str) -> str:
    return STATE_PACK.format(season=season)
