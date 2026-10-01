"""MoneyPuck shot files as an xG benchmark (DESIGN §2.1, §3.1; decision D3).

Source: ``https://peter-tanner.com/moneypuck/downloads/shots_<year>.zip`` (one
~20 MB zip per season, ``<year>`` = season start year).  Data courtesy of
MoneyPuck.com; the site credits MoneyPuck wherever it is used.

MoneyPuck rows are unblocked attempts.  ``game_id`` is the 5-digit in-season id
(``20001``); ``id`` is MoneyPuck's own sequence number, *not* the NHL ``eventId``,
so a row joins the lake on (``season*1e6 + game_id``, period, game second
``time``, shooter id, event type), see ``join_keys``; ambiguous keys are dropped.

Caveat for the benchmark: MoneyPuck's published ``xGoal`` comes from a model
trained on data that includes the season being scored, so on our held-out
seasons it is an in-sample (optimistic) reference, not a walk-forward one.
"""
from __future__ import annotations

import os
import time

import pandas as pd

URL = "https://peter-tanner.com/moneypuck/downloads/shots_{year}.zip"
COLUMNS = ["game_id", "id", "season", "period", "time", "event", "goal", "xGoal", "shooterPlayerId",
           "shooterLeftRight", "isPlayoffGame", "shotOnEmptyNet", "homeSkatersOnIce", "awaySkatersOnIce",
           "isHomeTeam", "shotDistance", "shotAngle", "xCord", "yCord", "shotType"]


def download(out_dir: str, years, pause: float = 1.0) -> list[str]:
    """Fetch ``shots_<year>.zip`` for each year not already present (plain GET, polite)."""
    from http_utils import request_bytes
    os.makedirs(out_dir, exist_ok=True)
    got = []
    for y in years:
        p = os.path.join(out_dir, f"shots_{y}.zip")
        if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
            got.append(p)
            continue
        body = request_bytes(URL.format(year=y), timeout=120, retries=3, ua="plain", quiet=True)
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, p)
        got.append(p)
        time.sleep(pause)
    return got


def load_year(path: str, columns=None) -> pd.DataFrame:
    cols = columns or COLUMNS
    head = pd.read_csv(path, nrows=0)
    use = [c for c in cols if c in head.columns]
    df = pd.read_csv(path, usecols=use, low_memory=False)
    if "season" in df.columns and "game_id" in df.columns:
        df["nhl_game_id"] = df["season"].astype("int64") * 1_000_000 + df["game_id"].astype("int64")
    if "event" in df.columns:
        df["type_code"] = df["event"].map(EVENT_CODES)
    if "time" in df.columns:
        df["game_seconds"] = pd.to_numeric(df["time"], errors="coerce")
    return df


EVENT_CODES = {"GOAL": 505, "SHOT": 506, "MISS": 507}
JOIN_KEYS = ["game_id", "period", "game_seconds", "shooter_id", "type_code"]


def join_keys(mp: pd.DataFrame) -> pd.DataFrame:
    """MoneyPuck rows keyed like lake shots; keys that occur twice are dropped."""
    k = pd.DataFrame({"game_id": mp["nhl_game_id"].astype("int64"),
                      "period": pd.to_numeric(mp["period"], errors="coerce"),
                      "game_seconds": pd.to_numeric(mp["game_seconds"], errors="coerce"),
                      "shooter_id": pd.to_numeric(mp["shooterPlayerId"], errors="coerce"),
                      "type_code": mp["type_code"], "xg_mp": mp["xGoal"]})
    k = k.dropna(subset=JOIN_KEYS)
    for c in JOIN_KEYS:
        k[c] = k[c].astype("int64")
    return k.drop_duplicates(JOIN_KEYS, keep=False)


def load_dir(mp_dir: str, years=None, columns=None) -> pd.DataFrame:
    if not mp_dir or not os.path.isdir(mp_dir):
        return pd.DataFrame()
    frames = []
    for fn in sorted(os.listdir(mp_dir)):
        if not (fn.startswith("shots_") and fn.endswith(".zip")):
            continue
        y = fn[len("shots_"):-len(".zip")]
        if not y.isdigit() or (years is not None and int(y) not in {int(v) for v in years}):
            continue
        cols = None if columns is None else list(dict.fromkeys(list(columns) + ["season", "game_id", "id"]))
        frames.append(load_year(os.path.join(mp_dir, fn), cols))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
