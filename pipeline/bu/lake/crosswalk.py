"""Player ID crosswalk (DESIGN §3.7, v0 for M0b).

``players`` (one row per player and season) is built from the per-game lineups
(boxscore + PBP ``rosterSpots`` + right-rail scratches) and the explicit-season
team rosters (``/v1/roster/{team}/{season}``, which also carry birth date,
handedness, height and weight).  ``name_key`` is an accent/punctuation-free
lower-case key so name-only sources (DailyFaceoff, HTML TOI reports, ESPN) can
be joined; ``resolve`` does that lookup with team/number tie-breaks.  The DFO-id
column is added by the M2 crosswalk (bu/crosswalk.py) on top of this table.
"""
from __future__ import annotations

import re
import unicodedata

import pandas as pd

_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv)\b")
# Common short/long first-name variants across NHL, DFO and ESPN spellings.
NICKNAMES = {
    "alex": "alexander", "alexandre": "alexander", "mitch": "mitchell", "mike": "michael",
    "matt": "matthew", "nick": "nicholas", "nicolas": "nicholas", "chris": "christopher",
    "jake": "jacob", "josh": "joshua", "zach": "zachary", "zack": "zachary", "tony": "anthony",
    "dan": "daniel", "danny": "daniel", "will": "william", "joe": "joseph", "tom": "thomas",
    "jon": "jonathan", "cam": "cameron", "sam": "samuel", "max": "maxime", "pat": "patrick",
    "nate": "nathan", "ben": "benjamin", "jt": "j t", "tj": "t j", "pj": "p j",
}


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")


def name_key(name: str, *, first_alias: bool = False) -> str:
    """'Tim Stützle' -> 'tim stutzle'; 'J.T. Miller' -> 'j t miller'."""
    s = _ascii(str(name or "")).lower()
    s = s.replace(".", " ").replace("-", " ").replace("'", "")
    s = re.sub(r"[^a-z ]+", " ", s)
    s = _SUFFIX.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if first_alias and s:
        parts = s.split(" ")
        parts[0] = NICKNAMES.get(parts[0], parts[0])
        s = " ".join(parts)
    return s


def _default(v):
    if isinstance(v, dict):
        return v.get("default")
    return v


def roster_rows(roster: dict, season: str, team_abbrev: str) -> list[dict]:
    """Flatten one /v1/roster/{team}/{season} payload."""
    rows = []
    for group in ("forwards", "defensemen", "goalies"):
        for p in roster.get(group) or []:
            first, last = _default(p.get("firstName")) or "", _default(p.get("lastName")) or ""
            rows.append({
                "season": season, "player_id": int(p["id"]), "team_abbrev": team_abbrev,
                "first_name": first, "last_name": last, "position": p.get("positionCode"),
                "sweater_number": p.get("sweaterNumber"), "shoots": p.get("shootsCatches"),
                "birth_date": p.get("birthDate"), "birth_country": p.get("birthCountry"),
                "height_in": p.get("heightInInches"), "weight_lb": p.get("weightInPounds"),
            })
    return rows


def build_players(lineups: pd.DataFrame, season_rosters: pd.DataFrame | None, season: str) -> pd.DataFrame:
    """One row per player for ``season`` (union of game lineups and team rosters)."""
    cols = ["season", "player_id", "first_name", "last_name", "full_name", "name_key", "name_key_alias",
            "position", "shoots", "birth_date", "birth_country", "height_in", "weight_lb",
            "team_abbrevs", "sweater_numbers", "games_dressed", "games_scratched", "on_season_roster"]
    parts = []
    if lineups is not None and not lineups.empty:
        lu = lineups.copy()
        lu["dressed"] = lu["status"].eq("dressed")
        lu["scratched"] = lu["status"].eq("scratched")
        g = lu.groupby("player_id")
        a = pd.DataFrame({
            "first_name": g["first_name"].agg(lambda s: next((x for x in s if x), "")),
            "last_name": g["last_name"].agg(lambda s: next((x for x in s if x), "")),
            "position": g["position"].agg(lambda s: next((x for x in s if x), None)),
            "team_abbrevs": g["team_abbrev"].agg(lambda s: sorted({x for x in s if x})),
            "sweater_numbers": g["sweater_number"].agg(
                lambda s: sorted({str(int(x)) for x in s if pd.notna(x)})),
            "games_dressed": g["dressed"].sum().astype(int),
            "games_scratched": g["scratched"].sum().astype(int),
        }).reset_index()
        parts.append(a)
    if season_rosters is not None and not season_rosters.empty:
        r = season_rosters.copy()
        g = r.groupby("player_id")
        b = pd.DataFrame({
            "first_name_r": g["first_name"].first(), "last_name_r": g["last_name"].first(),
            "position_r": g["position"].first(), "shoots": g["shoots"].first(),
            "birth_date": g["birth_date"].first(), "birth_country": g["birth_country"].first(),
            "height_in": g["height_in"].first(), "weight_lb": g["weight_lb"].first(),
            "teams_r": g["team_abbrev"].agg(lambda s: sorted({x for x in s if x})),
            "numbers_r": g["sweater_number"].agg(lambda s: sorted({str(int(x)) for x in s if pd.notna(x)})),
        }).reset_index()
        parts.append(b)
    if not parts:
        return pd.DataFrame(columns=cols)
    df = parts[0]
    for p in parts[1:]:
        df = df.merge(p, on="player_id", how="outer")
    for c, rc in (("first_name", "first_name_r"), ("last_name", "last_name_r"), ("position", "position_r")):
        if c not in df.columns:
            df[c] = None
        if rc in df.columns:
            df[c] = df[c].where(df[c].notna() & (df[c] != ""), df[rc])
    on_roster = df["teams_r"].notna() if "teams_r" in df.columns else pd.Series(False, index=df.index)

    def _union(a, b):
        out = set()
        for v in (a, b):
            if isinstance(v, (list, tuple)):
                out.update(v)
            elif hasattr(v, "tolist"):
                out.update(v.tolist())
        return sorted(out)

    df["team_abbrevs"] = [_union(a, b) for a, b in zip(df.get("team_abbrevs", [None] * len(df)),
                                                       df.get("teams_r", [None] * len(df)))]
    df["sweater_numbers"] = [_union(a, b) for a, b in zip(df.get("sweater_numbers", [None] * len(df)),
                                                          df.get("numbers_r", [None] * len(df)))]
    for c in ("games_dressed", "games_scratched"):
        df[c] = df[c].fillna(0).astype(int) if c in df.columns else 0
    df["on_season_roster"] = on_roster.values
    df["season"] = season
    df["full_name"] = (df["first_name"].fillna("") + " " + df["last_name"].fillna("")).str.strip()
    df["name_key"] = df["full_name"].map(name_key)
    df["name_key_alias"] = df["full_name"].map(lambda s: name_key(s, first_alias=True))
    for c in cols:
        if c not in df.columns:
            df[c] = None
    df["player_id"] = df["player_id"].astype("int64")
    return df[cols].sort_values("player_id").reset_index(drop=True)


def resolve(players: pd.DataFrame, name: str, *, team: str | None = None,
            number: int | str | None = None) -> int | None:
    """Best player_id for a display name (+ optional team abbrev / sweater number)."""
    if players is None or players.empty or not name:
        return None
    k, ka = name_key(name), name_key(name, first_alias=True)
    cand = players[(players["name_key"] == k) | (players["name_key_alias"] == ka)]
    if cand.empty:
        last = k.split(" ")[-1] if k else ""
        cand = players[players["name_key"].str.split(" ").str[-1] == last]
        if number is not None:
            cand = cand[cand["sweater_numbers"].map(lambda ns: str(number) in list(ns))]
        if team is not None:
            cand = cand[cand["team_abbrevs"].map(lambda ts: team in list(ts))]
        return int(cand["player_id"].iloc[0]) if len(cand) == 1 else None
    if len(cand) > 1 and team is not None:
        t = cand[cand["team_abbrevs"].map(lambda ts: team in list(ts))]
        cand = t if len(t) else cand
    if len(cand) > 1 and number is not None:
        n = cand[cand["sweater_numbers"].map(lambda ns: str(number) in list(ns))]
        cand = n if len(n) else cand
    if len(cand) > 1:
        cand = cand.sort_values("games_dressed", ascending=False)
    return int(cand["player_id"].iloc[0])
