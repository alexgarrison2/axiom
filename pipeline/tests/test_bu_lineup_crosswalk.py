"""bu.lineup.crosswalk: DFO names -> NHL ids, offline (fake roster payloads, no network)."""
from __future__ import annotations

import pandas as pd

from bu.lake.build import write_table
from bu.lake.paths import Lake
from bu.lineup import crosswalk as X
from bu.rapm.paths import RapmPaths


def _p(pid, first, last, num, pos):
    return {"id": pid, "firstName": {"default": first}, "lastName": {"default": last},
            "sweaterNumber": num, "positionCode": pos}


ROSTERS = {
    "TOR": {"forwards": [_p(1, "Mitchell", "Marner", 16, "R"), _p(2, "Auston", "Matthews", 34, "C"),
                         _p(3, "Alexis", "Lafrenière", 13, "L")],
            "defensemen": [_p(4, "Morgan", "Rielly", 44, "D")], "goalies": [_p(5, "Joseph", "Woll", 60, "G")]},
    "MTL": {"forwards": [_p(6, "Nick", "Suzuki", 14, "C"), _p(7, "Josh", "Anderson", 17, "R")],
            "defensemen": [_p(8, "Mike", "Matheson", 8, "D")], "goalies": []},
}


def _paths(tmp_path):
    return RapmPaths(Lake(str(tmp_path)))


def test_norm_name():
    assert X.norm_name("Alexis Lafrenière") == "alexis lafreniere"
    assert X.norm_name("Pierre-Luc Dubois") == "pierre luc dubois"
    assert X.norm_name("Martin St. Louis Jr.") == "martin st louis"
    assert X.norm_name(None) == ""


def test_build_caches_and_resolves(tmp_path):
    calls = []

    def getter(url):
        calls.append(url)
        team = url.split("/roster/")[1].split("/")[0]
        assert url.endswith("/20262027")            # explicit season id, never /now
        return ROSTERS[team]

    paths = _paths(tmp_path)
    cw = X.build(paths, "20262027", ["TOR", "MTL"], getter=getter)
    assert len(calls) == 2 and len(cw) == 8
    X.build(paths, "20262027", ["TOR", "MTL"], getter=getter)
    assert len(calls) == 2                           # cached raw payloads
    r = X.Resolver(cw)
    assert r.resolve("TOR", "Auston Matthews") == (2, "team_name")
    assert r.resolve("TOR", "Alexis Lafreniere")[0] == 3           # accents
    assert r.resolve("TOR", "Mitch Marner", 16) == (1, "team_number_last")   # nickname
    assert r.resolve("TOR", "M. Rielly")[0] == 4                   # unique last name on the team
    assert r.resolve("NJD", "Nick Suzuki") == (6, "league_name")   # traded: league-wide unique name
    assert r.resolve("TOR", "Nobody Here") == (None, "unmapped")


def test_lake_rows_cover_callups(tmp_path):
    lake = Lake(str(tmp_path))
    lu = pd.DataFrame({"game_id": [2025020001, 2025020500], "season": "20252026", "team_abbrev": ["TOR", "TOR"],
                       "player_id": [9, 9], "first_name": ["Easton", "Easton"], "last_name": ["Cowan", "Cowan"],
                       "sweater_number": [53, 53], "position": ["C", "C"]})
    write_table(lu, lake.table_path("lineups", "20252026"))
    paths = RapmPaths(lake)
    cw = X.build(paths, "20262027", ["TOR"], lake_seasons=["20252026"], getter=lambda u: ROSTERS["TOR"])
    assert (cw["player_id"] == 9).sum() == 1
    assert X.Resolver(cw).resolve("TOR", "Easton Cowan") == (9, "team_name_lake")


def test_dfo_coverage_drops_injured_and_counts():
    cw = pd.DataFrame(X.roster_rows(ROSTERS["TOR"], "TOR"), columns=X.CW_COLUMNS)
    dfo = {"TOR": {"f1": [{"name": "Mitch Marner", "number": 16}, {"name": "Auston Matthews", "number": 34},
                          {"name": "Unknown Guy", "number": 99}],
                   "d1": [{"name": "Morgan Rielly", "number": 44},
                          {"name": "Hurt Player", "number": 2, "injuryStatus": "IR"}],
                   "g1": [{"name": "Joseph Woll", "number": 60}]},
           "generated_at": "x"}
    sk = X.dfo_skaters(dfo, "TOR")
    assert [p["name"] for p in sk] == ["Mitch Marner", "Auston Matthews", "Unknown Guy", "Morgan Rielly"]
    cov = X.coverage(X.Resolver(cw), dfo)
    t = cov["per_team"]["TOR"]
    assert t["n"] == 4 and t["mapped"] == 3 and t["unmapped"] == ["Unknown Guy"] and not t["ok"]
    assert cov["teams"] == 1 and cov["share_ok"] == 0.0
