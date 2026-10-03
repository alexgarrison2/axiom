"""
backtest_props.py — calibration of prop_model's fair probabilities.

Replays a finished season in game order: each player-game is priced from the
player's previous games only (history crosses into earlier seasons when their
skater_games file exists) and scored against the result. Reports log loss and
Brier for every prop next to two baselines: the league base rate and the
player's own last-10 hit rate (shrunk 2 games toward the base rate), plus a
reliability table.

    cd pipeline && python3 tools/backtest_props.py [--season 2025] [--from 2025-11-15]

Record (2026-10-03, 2025-26 from Nov 15, 35,261 player-games, log loss
fair / last-10 / base rate): SOG o1.5 0.612 / 0.786 / 0.684, o2.5 0.462 /
0.626 / 0.530, o3.5 0.285 / 0.408 / 0.333, ATG 0.401 / 0.500 / 0.431,
1+ A 0.525 / 0.626 / 0.557, 1+ P 0.600 / 0.734 / 0.649, 2+ P 0.274 / 0.370 /
0.309, 1+ PPP 0.246 / 0.374 / 0.300. Pooled reliability within ~1 point per
10% bin. League position priors use the whole replayed season (a negligible
look-ahead: one game among ~47k rows).
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fetch_skater_games import games_file  # noqa: E402
import prop_model as pm  # noqa: E402


def logloss(p, y):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--from", dest="since", default=None)
    ap.add_argument("--min-prev", type=int, default=10)
    a = ap.parse_args(argv)
    frames = [pd.read_csv(games_file(y)) for y in (a.season - 1, a.season) if os.path.exists(games_file(y))]
    logs = pd.concat(frames, ignore_index=True)
    df = pm.pregame_features(logs)
    fair = pm.fair_probs(df)
    since = a.since or f"{a.season}-11-15"
    keep = (df["date"] >= since) & (df["game_id"] // 10000 == a.season * 100 + 2) & (df["n_prev"] >= a.min_prev)
    df, fair = df[keep], fair[keep]
    print(f"{len(df)} player-games from {since}, >= {a.min_prev} previous games")
    print(f"{'prop':6} {'base':>6} {'LL fair':>8} {'LL L10':>8} {'LL base':>8} {'Brier':>7} {'mean p':>7}")
    srt = logs.sort_values(["player_id", "date", "game_id"])
    for key, stat, k in pm.PROPS:
        hit_all = (srt[stat] >= k).astype(float)
        l10 = hit_all.groupby(srt["player_id"]).transform(lambda x: x.shift(1).rolling(10, min_periods=1).sum())
        n10 = hit_all.groupby(srt["player_id"]).transform(lambda x: x.shift(1).rolling(10, min_periods=1).count())
        y = (df[stat] >= k).astype(float).to_numpy()
        base = y.mean()
        l10p = ((l10 + 2 * base) / (n10 + 2)).reindex(df.index).fillna(base).to_numpy()
        p = fair[key].to_numpy()
        print(f"{key:6} {base:6.3f} {logloss(p, y):8.4f} {logloss(l10p, y):8.4f} {logloss(np.full_like(y, base), y):8.4f}"
              f" {np.mean((p - y) ** 2):7.4f} {p.mean():7.3f}")
    print("\nReliability (all props pooled): predicted bin -> observed")
    ys, ps = [], []
    for key, stat, k in pm.PROPS:
        ys.append((df[stat] >= k).astype(float).to_numpy())
        ps.append(fair[key].to_numpy())
    y, p = np.concatenate(ys), np.concatenate(ps)
    bins = np.linspace(0, 1, 11)
    idx = np.digitize(p, bins) - 1
    for b in range(10):
        m = idx == b
        if m.sum() > 200:
            print(f"  {bins[b]:.1f}-{bins[b + 1]:.1f}: n={m.sum():6d} pred={p[m].mean():.3f} obs={y[m].mean():.3f}")


if __name__ == "__main__":
    main()
