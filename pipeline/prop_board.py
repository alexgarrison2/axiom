"""
prop_board.py — public/data/props.json for the /props page.

Joins five inputs per skater:
  * game logs        nhl_season_*_skater_games.csv (current + previous season;
                     the last LOG_GAMES games, flagged by season, feed the
                     page's L5/L10/L20 tapes), plus nhl_historical_skater_games.csv
                     for his games against tonight's opponent
  * shot xG          nhl_season_*_shots.csv (pony xG per shot, summed per game)
  * lines            DailyFaceoff lineups (forward line / D pair / PP unit,
                     movement up/down) for linemate context
  * book prices      Bovada player props (pipeline/player_props.json)
  * fair prices      prop_model.py (game model expected goals as team context)

The slate is today's games (America/New_York). Every skater on a current
DailyFaceoff lineup or with a game this season is listed; slate skaters also
carry tonight's opponent, fair probabilities and book prices.

The opened-row detail is a second file, public/data/props_detail.json, fetched
by the browser only when a row is opened:
  { generated_at, slate_date, players: { id: {
      x:  [[date, missed, blocked, ev_toi, pp_toi, ixg], ...],  # same games as log
      ha: { h: {n, key: hits}, a: {...} },                      # home / road, both seasons
      vs: [[date, home, toi, g, a, sog, ppp, att], ...],        # last VS_GAMES vs tonight's opp
      vs_n: games vs tonight's opp since the archive starts } } }

Shape (keys kept short; the file is fetched by the browser):
  { generated_at, season, prev_season, slate_date, props: [...],
    games: [{ id, start, home, away, home_xg, away_xg, total, priced,
              goalies: {home, away: {name, status, gsax}}, rest: {home, away} }],
    teams: { TRI: { sa_rank, ga_rank } },           # 1 = allows the most
    players: [{ id, name, team, pos, unit, pp, move, mates: [ids], gp, gp_prev,
                game, opp, home, toi, fair: {key: p}, book: {key: {...}},
                log: [[date, opp, home, toi, g, a, sog, ppp, prev, att], ...],
                cur: {key: hits}, prev: {key: hits} }] }
"""
from __future__ import annotations

import os
import unicodedata

import numpy as np
import pandas as pd

import prop_model as pm
from fetch_skater_games import games_file
from io_utils import atomic_write_json, keep_if_unchanged, read_json, utc_now_iso
from paths import pipeline_path, public_path
from season import START_YEAR, PREV_START_YEAR, SEASON_ID, PREV_SEASON_ID, season_file, today_local

OUT_FILE = public_path("props.json")
DETAIL_FILE = public_path("props_detail.json")
HIST_FILE = pipeline_path("nhl_historical_skater_games.csv")
LOG_GAMES = 20
VS_GAMES = 10
UNITS = ["f1", "f2", "f3", "f4", "d1", "d2", "d3"]
SOG_KEYS = {1.5: "sog15", 2.5: "sog25", 3.5: "sog35"}
ONE_WAY = ["atg", "a1", "p1", "p2", "ppp1"]
LABELS = {"sog15": "SOG 1.5", "sog25": "SOG 2.5", "sog35": "SOG 3.5", "atg": "ATG", "a1": "1+ AST",
          "p1": "1+ PTS", "p2": "2+ PTS", "ppp1": "1+ PPP"}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFD", name or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower().replace("-", " ").replace(".", "")
    return " ".join("".join(c for c in s if c.isalnum() or c == " ").split())


def load_logs() -> pd.DataFrame:
    frames = []
    for y in (PREV_START_YEAR, START_YEAR):
        if os.path.exists(games_file(y)):
            f = pd.read_csv(games_file(y))
            f["prev"] = int(y != START_YEAR)
            frames.append(f)
    logs = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if logs.empty:
        return logs
    ixg, scraped = load_ixg()
    logs = logs.merge(ixg, on=["game_id", "player_id"], how="left")
    # In a scraped game, no unblocked attempt is 0 xG; games the shot scrape has not reached stay missing.
    logs.loc[logs["game_id"].isin(scraped) & logs["ixg"].isna(), "ixg"] = 0.0
    return logs


def load_ixg() -> tuple[pd.DataFrame, set]:
    """Individual xG per (game, shooter): pony xG summed over his unblocked attempts,
    and the set of games the shot scrape covers."""
    frames = []
    for y in (PREV_START_YEAR, START_YEAR):
        path = pipeline_path(season_file("shots", y))
        if os.path.exists(path):
            frames.append(pd.read_csv(path, usecols=["game_id", "player_id", "xG"]))
    if not frames:
        return pd.DataFrame(columns=["game_id", "player_id", "ixg"]), set()
    shots = pd.concat(frames, ignore_index=True)
    ixg = shots.groupby(["game_id", "player_id"], as_index=False)["xG"].sum().rename(columns={"xG": "ixg"})
    return ixg, set(shots["game_id"])


def load_history(current: pd.DataFrame) -> pd.DataFrame:
    """Every archived player-game plus the current logs, one row per (game, player)."""
    cols = ["game_id", "date", "player_id", "opp", "home", "toi", "goals", "assists", "points", "shots",
            "pp_points", "attempts"]
    frames = [current[[c for c in cols if c in current.columns]]]
    if os.path.exists(HIST_FILE):
        hist = pd.read_csv(HIST_FILE, usecols=lambda c: c in cols)
        frames.insert(0, hist)
    out = pd.concat(frames, ignore_index=True)
    return out.drop_duplicates(["game_id", "player_id"], keep="last").sort_values(["date", "game_id"])


def _int(v):
    return None if pd.isna(v) else int(v)


def _num(v, nd=2):
    return None if pd.isna(v) else round(float(v), nd)


def _slate(today: str):
    games = [g for g in read_json(pipeline_path("upcoming_games.json"), []) or []
             if g.get("gameDate") == today and str(g.get("gameType", 2)) == "2"]
    xg = {}
    pred_path = public_path("predictions_detailed.csv")
    if os.path.exists(pred_path):
        pred = pd.read_csv(pred_path, usecols=["nhl_game_id", "home_xg", "away_xg"])
        xg = {int(r.nhl_game_id): (r.home_xg, r.away_xg) for r in pred.itertuples()}
    odds = read_json(pipeline_path("odds.json"), {}) or {}
    return games, xg, odds


def _lineups(id_by_name: dict) -> dict:
    """{player_id: {unit, pp, move, mates_names}} from DailyFaceoff lineups."""
    out = {}
    raw = read_json(pipeline_path("team_lineups.json"), {}) or {}
    for team, lu in raw.items():
        if not isinstance(lu, dict):
            continue
        for unit in UNITS:
            members = lu.get(unit) or []
            ids = [id_by_name.get((norm(p.get("name")), team)) for p in members]
            for p, pid in zip(members, ids):
                if pid is None:
                    continue
                out[pid] = {"unit": unit.upper(), "pp": p.get("ppUnit"), "move": p.get("movement"),
                            "mates": [m for m in ids if m is not None and m != pid], "team": team}
    return out


def _book(entry: dict | None) -> dict:
    """Book prices for one player: O/U markets de-vigged, one-way markets raw (vig included)."""
    if not entry:
        return {}
    out = {}
    for ln in entry.get("sog") or []:
        key = SOG_KEYS.get(float(ln["line"]))
        if not key:
            continue
        po, pu = pm.american_to_prob(ln.get("over")), pm.american_to_prob(ln.get("under"))
        fair_over = po / (po + pu) if po and pu else po
        out[key] = {"over": ln.get("over"), "under": ln.get("under"), "imp": round(fair_over, 4) if fair_over else None,
                    "devig": bool(po and pu)}
    for key in ONE_WAY:
        if entry.get(key) is not None:
            out[key] = {"over": entry[key], "imp": round(pm.american_to_prob(entry[key]), 4), "devig": False}
    return out


def _team_ranks(logs: pd.DataFrame) -> dict:
    """Opponent context: decayed shots and goals allowed per game, ranked (1 = allows the most)."""
    tc = pm.team_context(logs)
    a = 0.5 ** (1.0 / pm.TEAM_HALF_LIFE)
    rows = {}
    for team, part in tc.groupby("team"):
        w = a ** np.arange(len(part))[::-1]
        rows[team] = {c: float((part[c].to_numpy() * w).sum() / w.sum()) for c in ["sa", "ga"]}
    df = pd.DataFrame.from_dict(rows, orient="index")
    df["sa_rank"] = df["sa"].rank(ascending=False, method="min").astype(int)
    df["ga_rank"] = df["ga"].rank(ascending=False, method="min").astype(int)
    return {t: {"sa": round(r.sa, 1), "ga": round(r.ga, 2), "sa_rank": int(r.sa_rank), "ga_rank": int(r.ga_rank)}
            for t, r in df.iterrows()}


def _goalie(name, status, ratings: dict) -> dict | None:
    if not name:
        return None
    r = ratings.get(name) or {}
    gsax = r.get("gsax_per_game")
    return {"name": name, "status": status, "gsax": None if gsax is None else round(float(gsax), 2)}


def _rest(logs: pd.DataFrame, today: str) -> dict:
    """Days since each team's last game before today (1 = played yesterday)."""
    last = logs.loc[logs["date"] < today].groupby("team")["date"].max()
    t = pd.Timestamp(today)
    return {team: int((t - pd.Timestamp(d)).days) for team, d in last.items()}


def _hits(part: pd.DataFrame) -> dict:
    return {key: int((part[stat] >= k).sum()) for key, stat, k in pm.PROPS}


def build(today=None) -> tuple[dict, dict]:
    today = str(today or today_local())
    logs = load_logs()
    if logs.empty:
        raise RuntimeError("no skater game logs")
    logs = logs.sort_values(["date", "game_id"])
    latest = logs.groupby("player_id").tail(1).set_index("player_id")
    id_by_name = {(norm(r["name"]), r["team"]): pid for pid, r in latest.iterrows()}
    lineups = _lineups(id_by_name)
    games, xg, odds = _slate(today)
    ratings = read_json(public_path("goalie_ratings.json"), {}) or {}
    rest = _rest(logs, today)
    props_raw = (read_json(pipeline_path("player_props.json"), {}) or {}).get("games", {})

    # Who is listed: current lineups plus anyone who has played this season.
    cur_ids = set(logs.loc[logs["prev"] == 0, "player_id"])
    ids = sorted(set(lineups) | cur_ids)
    team_of = {pid: (lineups[pid]["team"] if pid in lineups else latest.at[pid, "team"]) for pid in ids if pid in latest.index}

    lineup_teams = {lu["team"] for lu in lineups.values()}
    # Tonight rows for slate skaters.
    tonight, game_rows = [], []
    for g in games:
        gid, home, away = int(g["id"]), g.get("homeTeamAbbrev"), g.get("awayTeamAbbrev")
        hx, ax = xg.get(gid, (None, None))
        o = odds.get(str(gid), {})
        game_rows.append({"id": gid, "start": g.get("startTimeUTC"), "state": g.get("gameState"),
                          "home": home, "away": away,
                          "home_xg": None if pd.isna(hx) else round(float(hx), 2),
                          "away_xg": None if pd.isna(ax) else round(float(ax), 2),
                          "total": o.get("total_line"), "priced": str(gid) in props_raw,
                          "goalies": {"home": _goalie(g.get("homeGoalieConfirmed"), g.get("homeGoalieStatus"), ratings),
                                      "away": _goalie(g.get("awayGoalieConfirmed"), g.get("awayGoalieStatus"), ratings)},
                          "rest": {"home": rest.get(home), "away": rest.get(away)}})
        for pid, t in team_of.items():
            # A team with a posted lineup dresses only its lineup; otherwise everyone on it is listed.
            if t not in (home, away) or (t in lineup_teams and pid not in lineups):
                continue
            last = latest.loc[pid]
            tonight.append({"game_id": gid, "date": today, "player_id": pid, "name": last["name"], "team": t,
                            "opp": away if t == home else home, "home": int(t == home), "pos": last["pos"],
                            "team_xg": hx if t == home else ax})
    frame = logs.copy()
    if tonight:
        tn = pd.DataFrame(tonight)
        for c in ["toi"] + pm.STATS:
            tn[c] = np.nan
        frame = pd.concat([frame, tn], ignore_index=True)
    feats = pm.pregame_features(frame)
    fair = pm.fair_probs(feats)
    feats = pd.concat([feats, fair.add_prefix("fair_")], axis=1)
    tonight_feats = feats[feats["shots"].isna()].set_index("player_id") if tonight else pd.DataFrame()

    # Book lookup by (game, normalized name).
    book_idx = {}
    for gid, g in props_raw.items():
        for name, entry in (g.get("players") or {}).items():
            book_idx[(int(gid), norm(name))] = entry

    by_player = {pid: part for pid, part in logs.groupby("player_id")}
    slate_ids = set(tonight_feats.index) if len(tonight_feats) else set()
    hist = load_history(logs)
    by_player_hist = {pid: part for pid, part in hist[hist["player_id"].isin(slate_ids)].groupby("player_id")}
    players, detail = [], {}
    for pid in ids:
        part = by_player.get(pid)
        if part is None or pid not in team_of:
            continue
        last = latest.loc[pid]
        recent = part.tail(LOG_GAMES)
        lu = lineups.get(pid, {})
        cur, prev = part[part["prev"] == 0], part[part["prev"] == 1]
        p = {
            "id": int(pid), "name": last["name"], "team": team_of[pid], "pos": last["pos"],
            "unit": lu.get("unit"), "pp": lu.get("pp"), "move": lu.get("move"),
            "mates": [int(m) for m in lu.get("mates", [])],
            "gp": int(len(cur)), "gp_prev": int(len(prev)),
            "cur": _hits(cur), "prev": _hits(prev),
            "log": [[r.date, r.opp, int(r.home), round(float(r.toi), 1), int(r.goals), int(r.assists),
                     int(r.shots), int(r.pp_points), int(r.prev), _int(getattr(r, "attempts", None))]
                    for r in recent.itertuples()],
        }
        d = {
            "x": [[r.date, _int(getattr(r, "missed", None)), _int(getattr(r, "blocked", None)),
                   _num(getattr(r, "ev_toi", None), 1), _num(getattr(r, "pp_toi", None), 1),
                   _num(getattr(r, "ixg", None))] for r in recent.itertuples()],
            "ha": {k: {"n": int(len(side)), **_hits(side)} for k, side in
                   (("h", part[part["home"] == 1]), ("a", part[part["home"] == 0]))},
        }
        detail[int(pid)] = d
        if pid in tonight_feats.index:
            f = tonight_feats.loc[pid]
            vs = by_player_hist.get(pid)
            if vs is not None:
                vs = vs[vs["opp"] == f["opp"]]
                d["vs_n"] = int(len(vs))
                d["vs"] = [[r.date, int(r.home), _num(r.toi, 1), int(r.goals), int(r.assists), int(r.shots),
                            int(r.pp_points), _int(getattr(r, "attempts", None))] for r in vs.tail(VS_GAMES).itertuples()]
            p.update({"game": int(f["game_id"]), "opp": f["opp"], "home": int(f["home"]),
                      "toi": round(float(f["toi_exp"]), 1),
                      "fair": {key: round(float(f[f"fair_{key}"]), 4) for key, _, _ in pm.PROPS},
                      "book": _book(book_idx.get((int(f["game_id"]), norm(last["name"]))))})
        players.append(p)

    board = {
        "generated_at": utc_now_iso(), "season": SEASON_ID, "prev_season": PREV_SEASON_ID,
        "slate_date": today, "log_games": LOG_GAMES,
        "props": [{"key": k, "label": LABELS[k], "stat": s, "k": n} for k, s, n in pm.PROPS],
        "games": game_rows, "teams": _team_ranks(logs), "players": players,
        "book_source": "bovada" if props_raw else None,
        "book_fetched_at": (read_json(pipeline_path("player_props.json"), {}) or {}).get("fetched_at"),
    }
    return board, {"generated_at": board["generated_at"], "slate_date": today, "players": detail}


def main():
    # Only the build stamp changed: keep the old file so an hourly run without news commits nothing.
    new_board, new_detail = build()
    board = keep_if_unchanged(read_json(OUT_FILE), new_board, keys={"generated_at"})
    atomic_write_json(OUT_FILE, board, min_items=1, indent=None, separators=(",", ":"),
                      validator=lambda d: None if d["players"] else "no players")
    detail = keep_if_unchanged(read_json(DETAIL_FILE), new_detail, keys={"generated_at"})
    atomic_write_json(DETAIL_FILE, detail, min_items=1, indent=None, separators=(",", ":"),
                      validator=lambda d: None if d["players"] else "no players")
    n_slate = sum(1 for p in board["players"] if "game" in p)
    n_book = sum(1 for p in board["players"] if p.get("book"))
    print(f"  props board: {len(board['players'])} skaters, {n_slate} on tonight's slate, {n_book} with book prices")
    return {"status": "ok", "rows_written": len(board["players"])}


if __name__ == "__main__":
    main()
