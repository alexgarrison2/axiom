"""Player ID crosswalk: DailyFaceoff / free-text names -> NHL player ids (DESIGN §3.7).

Sources, in priority order (all free, explicit season ids, never ``/now``):

1. NHL season rosters ``api-web.nhle.com/v1/roster/{TEAM}/{season}``: id, name, sweater number,
   team, position.  Raw payloads are cached gzipped under ``<out>/crosswalk/raw/season=S``.
2. Dressed players from the lake's ``lineups`` table (PBP rosterSpots: id, name, number, team),
   most recent game first: covers players traded or recalled since the roster call.
3. ``pipeline/player_name_lookup.json`` would be the last resort (DESIGN); it is not needed by
   the backtest, which has NHL ids throughout.

``resolve`` matches, within the player's team first: normalised full name; sweater number +
last name; unique last name; then a league-wide unique full name.  Every DFO lineup entry
gets a ``method`` (or ``unmapped``) so a manifest stage can report coverage
(``coverage``: share of teams with >= 14 of 18 dressed skaters mapped, DESIGN §3.7
``lineup_coverage``).

    python -m bu.lineup crosswalk [--season 20262027] [--dfo ../public/data/team_lineups.json]
"""
from __future__ import annotations

import gzip
import json
import os
import re
import unicodedata

import pandas as pd

ROSTER_URL = "https://api-web.nhle.com/v1/roster/{team}/{season}"
OUT_STATUSES = {"out", "ir", "injured reserve", "ltir", "long-term injured reserve", "suspended"}
MIN_MAPPED = 14
CW_COLUMNS = ["player_id", "name", "norm", "last", "team", "sweater", "position", "pos_group", "source", "rank"]


def norm_name(s) -> str:
    """'Alexis Lafrenière' -> 'alexis lafreniere'; drops punctuation, suffixes and extra spaces."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[.'\-]", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _last(norm: str) -> str:
    return norm.split(" ")[-1] if norm else ""


def _group(pos) -> str:
    return "D" if str(pos).upper().startswith("D") else ("G" if str(pos).upper().startswith("G") else "F")


def _raw_path(paths, season, team) -> str:
    p = os.path.join(paths.root, "crosswalk", "raw", f"season={season}", f"{team}.json.gz")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def fetch_roster(paths, season: str, team: str, *, refresh: bool = False, getter=None) -> dict | None:
    p = _raw_path(paths, season, team)
    if os.path.exists(p) and not refresh:
        with gzip.open(p, "rt") as f:
            return json.load(f)
    if getter is None:
        from http_utils import try_get_json as getter
    d = getter(ROSTER_URL.format(team=team, season=season))
    if not d:
        return None
    with gzip.open(p + ".tmp", "wt") as f:
        json.dump(d, f)
    os.replace(p + ".tmp", p)
    return d


def roster_rows(payload: dict, team: str) -> list[dict]:
    rows = []
    for key in ("forwards", "defensemen", "goalies"):
        for r in payload.get(key) or []:
            fn = (r.get("firstName") or {}).get("default", "")
            ln = (r.get("lastName") or {}).get("default", "")
            name = f"{fn} {ln}".strip()
            rows.append({"player_id": int(r["id"]), "name": name, "norm": norm_name(name), "last": norm_name(ln),
                         "team": team, "sweater": r.get("sweaterNumber"), "position": r.get("positionCode"),
                         "pos_group": _group(r.get("positionCode")), "source": "roster", "rank": 0})
    return rows


def lake_rows(lake, seasons) -> list[dict]:
    from bu.lake.build import read_table
    lu = read_table(lake, "lineups", seasons, columns=["game_id", "team_abbrev", "player_id", "first_name",
                                                       "last_name", "sweater_number", "position"])
    if lu.empty:
        return []
    lu = lu.sort_values("game_id", ascending=False).drop_duplicates(["player_id", "team_abbrev"])
    out = []
    for r in lu.itertuples(index=False):
        name = f"{r.first_name or ''} {r.last_name or ''}".strip()
        team = r.team_abbrev
        out.append({"player_id": int(r.player_id), "name": name, "norm": norm_name(name),
                    "last": norm_name(r.last_name), "team": team,
                    "sweater": None if pd.isna(r.sweater_number) else int(r.sweater_number),
                    "position": r.position, "pos_group": _group(r.position), "source": "lake", "rank": 1})
    return out


def build(paths, season: str, teams, *, lake_seasons=(), getter=None, refresh: bool = False) -> pd.DataFrame:
    """One row per (player, team) with the roster call first; written to
    ``<out>/crosswalk/player_ids_<season>.parquet``."""
    rows = []
    for t in sorted(set(teams)):
        d = fetch_roster(paths, season, t, refresh=refresh, getter=getter)
        if d:
            rows.extend(roster_rows(d, t))
    if lake_seasons:
        rows.extend(lake_rows(paths.lake, lake_seasons))
    cw = pd.DataFrame(rows, columns=CW_COLUMNS)
    cw = cw.sort_values(["rank"], kind="stable").drop_duplicates(["player_id", "team"])
    p = os.path.join(paths.root, "crosswalk", f"player_ids_{season}.parquet")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    cw.to_parquet(p, index=False)
    return cw.reset_index(drop=True)


class Resolver:
    def __init__(self, cw: pd.DataFrame):
        self.cw = cw
        self.by_team = {t: g for t, g in cw.groupby("team")}
        cur = cw[cw["rank"] == cw["rank"].min()] if len(cw) else cw
        league = cur.drop_duplicates("player_id")
        counts = league["norm"].value_counts()
        self.league_unique = {n: int(league.loc[league["norm"] == n, "player_id"].iloc[0])
                              for n in counts[counts == 1].index}

    def resolve(self, team: str, name: str, number=None) -> tuple[int | None, str]:
        n = norm_name(name)
        if not n:
            return None, "unmapped"
        g = self.by_team.get(team)
        if g is not None and len(g):
            for rank in sorted(g["rank"].unique()):
                gr = g[g["rank"] == rank]
                hit = gr[gr["norm"] == n]
                if hit["player_id"].nunique() == 1:
                    return int(hit["player_id"].iloc[0]), "team_name" if rank == 0 else "team_name_lake"
                if number is not None and not pd.isna(number):
                    hit = gr[(gr["sweater"] == int(number)) & (gr["last"] == _last(n))]
                    if hit["player_id"].nunique() == 1:
                        return int(hit["player_id"].iloc[0]), "team_number_last"
                hit = gr[gr["last"] == _last(n)]
                if hit["player_id"].nunique() == 1:
                    return int(hit["player_id"].iloc[0]), "team_last"
        if n in self.league_unique:
            return self.league_unique[n], "league_name"
        return None, "unmapped"


def dfo_skaters(team_lineups: dict, team: str) -> list[dict]:
    """Projected dressed skaters from DFO ``team_lineups.json`` (forward lines f*, pairs d*),
    minus players flagged out / IR / suspended (DESIGN §3.7)."""
    t = team_lineups.get(team) or {}
    out = []
    for key, grp in t.items():
        if not isinstance(grp, list) or not re.fullmatch(r"[fd]\d", str(key)):
            continue
        for p in grp:
            st = str(p.get("injuryStatus") or "").lower()
            if st in OUT_STATUSES:
                continue
            out.append({"name": p.get("name"), "number": p.get("number"),
                        "group": "D" if key.startswith("d") else "F", "gtd": bool(p.get("gameTimeDecision"))})
    return out


def coverage(resolver: Resolver, team_lineups: dict, teams=None) -> dict:
    """Per team: projected skaters, mapped, unmapped names; overall share of teams >= MIN_MAPPED."""
    per = {}
    for team in sorted(teams or [k for k, v in team_lineups.items() if isinstance(v, dict)]):
        sk = dfo_skaters(team_lineups, team)
        mapped, unmapped, methods = [], [], {}
        for p in sk:
            pid, how = resolver.resolve(team, p["name"], p["number"])
            methods[how] = methods.get(how, 0) + 1
            (mapped if pid else unmapped).append(pid if pid else p["name"])
        per[team] = {"n": len(sk), "mapped": len(mapped), "unmapped": unmapped, "methods": methods,
                     "ok": len(mapped) >= MIN_MAPPED}
    ok = [v["ok"] for v in per.values() if v["n"]]
    return {"min_mapped": MIN_MAPPED, "teams": len(ok), "share_ok": (sum(ok) / len(ok)) if ok else None,
            "per_team": per}
