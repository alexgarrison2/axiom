"""
prop_model.py — pony xG fair probabilities for skater props.

Every probability comes from a per-game expected count (lambda) built from
the player's own history, regressed to his position's league rate:

    rate      = (decayed events + K * position rate) / (decayed TOI + K)   per minute
    toi       = recent-weighted TOI (role: line / PP promotions show up fast)
    lambda    = rate * toi * context

  SOG       context = opponent shots allowed / league        P(X >= k): negative binomial
  goals     context = team goal expectation / league          P(X >= 1): Poisson
  assists   same context as goals                             P(X >= k): Poisson
  points    same context as goals                             P(X >= k): Poisson
  PPP       per game (no PP TOI in the feed), same context    P(X >= 1): Poisson

History is decayed by games played (half-life HALF_LIFE games) and crosses
seasons, so early in a season last year's games still anchor the rate.

Arms of tools/prereg_props_calib.json (prop_board publishes DEFAULT_ARM;
PONYXG_PROP_ARM overrides it):
  base        the model above
  cal         base + a per-market logit shift fitted on the last CAL_WINDOW
              graded player-games (calibration_shifts / apply_shifts)
  struct      the prior is the rate of the player's position and expected-TOI
              band (toi_band_rates) instead of one pooled position rate
  struct_cal  struct + the same shift

``pregame_features`` computes the inputs for each row from the player's
*previous* games only, so the same code serves the backtest
(tools/backtest_props.py) and the live board (prop_board.py appends one
"tonight" row per slate player).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

STATS = ["shots", "goals", "assists", "points", "pp_points"]

# Tuned on 2025-26 (tools/backtest_props.py); see the docstring there for the record.
HALF_LIFE = 60          # games, event rates
TOI_HALF_LIFE = 6       # games, expected TOI
TEAM_HALF_LIFE = 30     # team games, context rates
K_MINUTES = {"shots": 100.0, "goals": 450.0, "assists": 250.0, "points": 200.0}
K_PPP_GAMES = 6.0
NB_SIZE = 15.0          # SOG overdispersion: var = mu + mu^2 / NB_SIZE
CONTEXT_POWER = {"shots": 0.7, "goals": 0.6}

# Arms of tools/prereg_props_calib.json: declared values, not tuned.
DEFAULT_ARM = "struct_cal"   # promoted 2026-10-14: passed the 2025-26 look (tools/prereg_props_calib_holdout.json)
ARMS = {"base": ("position", False), "cal": ("position", True),
        "struct": ("toi_band", False), "struct_cal": ("toi_band", True)}   # arm -> (prior, shift)
TOI_BANDS = {"F": (12.0, 15.0, 18.0), "D": (17.0, 20.0, 23.0)}
DEFAULT_TOI = {"F": 15.0, "D": 20.0}
CAL_WINDOW = 20000      # graded player-games behind each date's shift
CAL_V0 = 1000.0         # shrinkage: delta * V / (V + V0), V = sum p (1 - p)
CAL_MIN_ROWS = 2000

PROPS = [
    # key, stat, threshold
    ("sog15", "shots", 2), ("sog25", "shots", 3), ("sog35", "shots", 4),
    ("atg", "goals", 1), ("a1", "assists", 1),
    ("p1", "points", 1), ("p2", "points", 2), ("ppp1", "pp_points", 1),
]


def _ewm_prev(s: pd.Series, groups, half_life: float) -> pd.Series:
    """Decayed mean of each group's previous values (NaN on its first row)."""
    return s.groupby(groups).transform(lambda x: x.shift(1).ewm(halflife=half_life, ignore_na=True).mean())


def _neff_prev(groups, half_life: float, index) -> pd.Series:
    """Effective number of previous games behind an ewm mean."""
    a = 0.5 ** (1.0 / half_life)
    n = pd.Series(1, index=index).groupby(groups).cumcount()      # previous games
    return (1 - a ** n) / (1 - a)


def position_rates(logs: pd.DataFrame) -> dict:
    """League per-minute rates by position group (F/D) and PPP per game."""
    out = {}
    for grp, part in logs.groupby(logs["pos"].eq("D").map({True: "D", False: "F"})):
        toi = part["toi"].sum()
        out[grp] = {s: part[s].sum() / toi for s in ["shots", "goals", "assists", "points"]}
        out[grp]["pp_points_pg"] = part["pp_points"].mean()
    return out


def toi_band(grp, toi) -> np.ndarray:
    """Band index 0..3 of each TOI within its position group's TOI_BANDS."""
    grp, toi = np.asarray(grp), np.asarray(toi, dtype=float)
    out = np.zeros(len(toi), dtype=int)
    for g, edges in TOI_BANDS.items():
        m = grp == g
        out[m] = np.searchsorted(np.asarray(edges), toi[m], side="right")
    return out


def toi_band_rates(logs: pd.DataFrame) -> dict:
    """League per-minute rates (PPP per game) by position group and TOI band: {(grp, band): {stat: rate}}.

    Each player-season sits in the band of its mean TOI."""
    grp = np.where(logs["pos"].eq("D"), "D", "F")
    mean_toi = logs.groupby([logs["player_id"], logs["game_id"] // 1000000])["toi"].transform("mean")
    band = toi_band(grp, mean_toi)
    out = {}
    for (g, b), part in logs.groupby([grp, band]):
        toi = part["toi"].sum()
        out[(g, int(b))] = {s: part[s].sum() / toi for s in ["shots", "goals", "assists", "points"]}
        out[(g, int(b))]["pp_points_pg"] = part["pp_points"].mean()
    return out


def team_context(logs: pd.DataFrame) -> pd.DataFrame:
    """Per team-game: pre-game decayed goals for/against and shots against, plus league means.

    Built from the skater rows (sum of skater goals and shots per team-game)."""
    tg = logs.groupby(["game_id", "date", "team", "opp"], as_index=False)[["goals", "shots"]].sum()
    opp = tg[["game_id", "team", "goals", "shots"]].rename(
        columns={"team": "opp", "goals": "ga", "shots": "sa"})
    tg = tg.merge(opp, on=["game_id", "opp"], how="left").sort_values(["date", "game_id"])
    tg = tg.rename(columns={"goals": "gf", "shots": "sf"})
    g = tg["team"]
    for c in ["gf", "ga", "sa"]:
        tg[f"{c}_pre"] = _ewm_prev(tg[c], g, TEAM_HALF_LIFE)
    return tg


def pregame_features(logs: pd.DataFrame, lg: dict | None = None, prior: str = "position") -> pd.DataFrame:
    """Expected counts for every row, from that player's previous rows only.

    ``prior`` is the regression target: "position" (one league rate per F / D)
    or "toi_band" (the F / D rate of the band of the player's decayed mean
    previous TOI; DEFAULT_TOI when he has no previous game).

    ``logs`` must carry game_id, date, player_id, team, opp, pos, toi and the
    STATS columns (NaN outcomes are fine for "tonight" rows). Optional columns
    ``team_xg`` (the game model's expected goals for the player's team) and
    ``opp_sa`` override the history-based context."""
    df = logs.sort_values(["player_id", "date", "game_id"]).copy()
    lg = lg or position_rates(df.dropna(subset=["shots"]))
    played = df.dropna(subset=["shots"])
    league_gpg = played.groupby(["game_id", "team"])["goals"].sum().mean()
    league_spg = played.groupby(["game_id", "team"])["shots"].sum().mean()

    g = df["player_id"]
    df["n_prev"] = g.groupby(g).cumcount()
    neff = _neff_prev(g, HALF_LIFE, df.index)
    toi_m = _ewm_prev(df["toi"], g, HALF_LIFE)
    df["toi_exp"] = _ewm_prev(df["toi"], g, TOI_HALF_LIFE)
    pos_grp = np.where(df["pos"].eq("D"), "D", "F")
    if prior == "toi_band":
        bands = toi_band_rates(played)
        toi_ref = toi_m.fillna(pd.Series(pos_grp, index=df.index).map(DEFAULT_TOI))
        keys = list(zip(pos_grp, toi_band(pos_grp, toi_ref)))

        def prior_of(s):
            return np.array([bands.get(k, lg[k[0]])[s] for k in keys])
    elif prior == "position":
        def prior_of(s):
            return np.array([lg[p][s] for p in pos_grp])
    else:
        raise ValueError(f"unknown prior {prior!r}")
    for s in ["shots", "goals", "assists", "points"]:
        m = _ewm_prev(df[s], g, HALF_LIFE)
        k = K_MINUTES[s]
        df[f"rate_{s}"] = ((m * neff).fillna(0) + k * prior_of(s)) / ((toi_m * neff).fillna(0) + k)
    ppp_prior = prior_of("pp_points_pg")
    m = _ewm_prev(df["pp_points"], g, HALF_LIFE)
    df["rate_ppp_pg"] = ((m * neff).fillna(0) + K_PPP_GAMES * ppp_prior) / (neff + K_PPP_GAMES)

    # Context: opponent shot suppression and the team's goal expectation.
    tc = team_context(played)
    pre = tc[["game_id", "team", "gf_pre"]]
    opp_pre = tc[["game_id", "team", "ga_pre", "sa_pre"]].rename(columns={"team": "opp"})
    df = df.merge(pre, on=["game_id", "team"], how="left").merge(opp_pre, on=["game_id", "opp"], how="left")
    df = _fill_latest_context(df, tc)
    goal_ctx = (df["gf_pre"] / league_gpg) ** 0.5 * (df["ga_pre"] / league_gpg) ** 0.5
    if "team_xg" in df:
        goal_ctx = np.where(df["team_xg"].notna(), df["team_xg"] / league_gpg, goal_ctx)
    df["ctx_goals"] = pd.Series(goal_ctx, index=df.index).fillna(1.0).clip(0.6, 1.6)
    df["ctx_shots"] = (df["sa_pre"] / league_spg).fillna(1.0).clip(0.75, 1.3)

    toi = df["toi_exp"].fillna(df["pos"].eq("D").map({True: 20.0, False: 15.0}))
    df["toi_exp"] = toi
    df["lam_shots"] = df["rate_shots"] * toi * df["ctx_shots"] ** CONTEXT_POWER["shots"]
    gctx = df["ctx_goals"] ** CONTEXT_POWER["goals"]
    df["lam_goals"] = df["rate_goals"] * toi * gctx
    df["lam_assists"] = df["rate_assists"] * toi * gctx
    df["lam_points"] = df["rate_points"] * toi * gctx
    df["lam_pp_points"] = df["rate_ppp_pg"] * gctx
    return df


def _fill_latest_context(df: pd.DataFrame, tc: pd.DataFrame) -> pd.DataFrame:
    """Tonight's rows have no team-game row yet: use each team's latest post-game decayed rates."""
    miss = df["gf_pre"].isna() | df["ga_pre"].isna() | df["sa_pre"].isna()
    if not miss.any():
        return df
    a = 0.5 ** (1.0 / TEAM_HALF_LIFE)
    latest = {}
    for team, part in tc.groupby("team"):
        w = a ** np.arange(len(part))[::-1]
        latest[team] = {c: float(np.nansum(part[c].to_numpy() * w) / w[~np.isnan(part[c].to_numpy())].sum())
                        for c in ["gf", "ga", "sa"]}
    for i in df.index[miss]:
        t, o = df.at[i, "team"], df.at[i, "opp"]
        if pd.isna(df.at[i, "gf_pre"]) and t in latest:
            df.at[i, "gf_pre"] = latest[t]["gf"]
        if o in latest:
            if pd.isna(df.at[i, "ga_pre"]):
                df.at[i, "ga_pre"] = latest[o]["ga"]
            if pd.isna(df.at[i, "sa_pre"]):
                df.at[i, "sa_pre"] = latest[o]["sa"]
    return df


def p_at_least_poisson(lam, k: int):
    lam = np.asarray(lam, dtype=float)
    cdf = np.zeros_like(lam)
    term = np.exp(-lam)
    for i in range(k):
        cdf = cdf + term
        term = term * lam / (i + 1)
    return 1.0 - cdf


def p_at_least_nb(mu, k: int, size: float | None = None):
    """P(X >= k) for a negative binomial with mean mu and size r (var = mu + mu^2/r)."""
    size = NB_SIZE if size is None else size
    mu = np.asarray(mu, dtype=float)
    p = size / (size + mu)
    cdf = np.zeros_like(mu)
    term = p ** size                                        # P(X = 0)
    for i in range(k):
        cdf = cdf + term
        term = term * (i + size) / (i + 1) * (1 - p)
    return 1.0 - cdf


def fair_probs(df: pd.DataFrame) -> pd.DataFrame:
    """One column per prop key with the fair P(over)."""
    out = pd.DataFrame(index=df.index)
    for key, stat, k in PROPS:
        lam = df[f"lam_{stat}"]
        out[key] = p_at_least_nb(lam, k) if stat == "shots" else p_at_least_poisson(lam, k)
    return out


def outcomes(df: pd.DataFrame) -> pd.DataFrame:
    """One 0/1 column per prop key (NaN where the game has no result yet)."""
    out = pd.DataFrame(index=df.index)
    for key, stat, k in PROPS:
        out[key] = np.where(df[stat].isna(), np.nan, (df[stat] >= k).astype(float))
    return out


def _logit(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def fit_logit_shift(p, y, v0: float = CAL_V0, min_rows: int = CAL_MIN_ROWS) -> float:
    """Shrunk intercept shift: delta with sum sigmoid(logit p + delta) = sum y, times V / (V + v0)."""
    z, y = _logit(p), np.asarray(y, dtype=float)
    if len(z) < min_rows:
        return 0.0
    q = 1 / (1 + np.exp(-z))
    v = float(np.sum(q * (1 - q)))
    d = 0.0
    for _ in range(50):
        q = 1 / (1 + np.exp(-(z + d)))
        step = float(np.sum(y - q) / max(np.sum(q * (1 - q)), 1e-9))
        d += step
        if abs(step) < 1e-10:
            break
    return d * v / (v + v0)


def apply_shifts(fair: pd.DataFrame, shifts) -> pd.DataFrame:
    """p' = sigmoid(logit p + delta) per market; ``shifts`` maps key -> scalar or array aligned to ``fair``."""
    out = fair.copy()
    for key, _, _ in PROPS:
        if key in out and key in shifts:
            d = np.asarray(shifts[key], dtype=float)
            out[key] = 1 / (1 + np.exp(-(_logit(out[key]) + d)))
    return out


def calibration_shifts(dates, fair: pd.DataFrame, y: pd.DataFrame, targets, window: int = CAL_WINDOW,
                       v0: float = CAL_V0, min_rows: int = CAL_MIN_ROWS) -> pd.DataFrame:
    """Walk-forward shifts: for each target date D, fit on the last ``window`` graded rows dated before D.

    ``dates``, ``fair`` and ``y`` are aligned (graded rows only); returns one row per target date."""
    d = np.asarray(dates).astype(str)
    order = np.argsort(d, kind="stable")
    dsort = d[order]
    fv = {k: np.asarray(fair[k], dtype=float)[order] for k, _, _ in PROPS}
    yv = {k: np.asarray(y[k], dtype=float)[order] for k, _, _ in PROPS}
    rows = {}
    for t in sorted({str(t) for t in targets}):
        hi = int(np.searchsorted(dsort, t, side="left"))
        lo = max(0, hi - window)
        rows[t] = {k: fit_logit_shift(fv[k][lo:hi], yv[k][lo:hi], v0, min_rows) for k, _, _ in PROPS}
    return pd.DataFrame.from_dict(rows, orient="index")


def american_to_prob(price) -> float | None:
    if price is None or (isinstance(price, float) and math.isnan(price)):
        return None
    price = float(price)
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def prob_to_american(p: float) -> int | None:
    if p is None or not (0 < p < 1):
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))
