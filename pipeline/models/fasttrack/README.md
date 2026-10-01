# Fast track F1: lineup + starting-goalie features

DESIGN.md §8 F1 (with §3.4 goalies, §3.7 lineups); owner decision D8 (ship as
soon as the gate passes). Two features of the incumbent logistic + Elo game
model:

| Feature | Definition | Code |
|---|---|---|
| `d_lineup` | Tonight's lineup quality minus the team's baseline lineup (18 most-used skaters over its last 20 games), home minus away. Quality = TOI-weighted mean player value, scaled to 3 forwards + 2 defencemen on the ice (net xG/60). | `lineup_adjust.LineupState` |
| `d_goalie_swap` | Tonight's starter GSAx rating minus the rating of the team's usual starter (most starts in its last 20 games), both as of the day before; 0 when the usual starter starts. Home minus away. | `features.FeatureState.goalie_swap` |

Player value: MoneyPuck 5v5 on-ice relative xG/60 (on-ice xGF-xGA per 60
minus off-ice), seasons S-1 and S-2 weighted 1.0 / 0.5, shrunk toward 0 by
5v5 minutes (600 min = 50%). Players with no history get the pooled value of
fringe players at their position. Ratings for season S use completed seasons
only, so they are "as of" July 1 of S.

**Data credit: player data from [MoneyPuck.com](https://moneypuck.com)**
(free for non-commercial use; ponyxg.com is non-commercial, DECISIONS D3).

## Gate result (2026-10-01, `fasttrack_backtest.json`)

Walk-forward 2023-24 / 2024-25 / 2025-26 against the incumbent on the same
games, L-actual lineups for both. Selected and shipped: **`d_lineup` alone**.

| Candidate | Dev Δ (23+24) | Pooled Δ | Folds | Gate |
|---|---|---|---|---|
| lineup (`d_lineup`) | −0.00021 | −0.00018 (SE 0.00035) | +0.00040 / −0.00091 / −0.00012 | **pass** |
| lineup, same-season baseline | +0.00007 | −0.00009 | +0.00012 / +0.00001 / −0.00039 | pass, not selected (dev Δ > 0) |
| goalie swap | +0.00030 | +0.00022 | −0.00039 / +0.00110 / +0.00008 | fail |
| lineup + goalie swap | +0.00011 | +0.00005 | +0.00001 / +0.00022 / −0.00007 | fail |
| lineup + level | −0.00152 | −0.00104 | +0.00042 / −0.00378 / −0.00014 | fail: 2025 slope 0.843 |

Shipped model `logit-elo-v5-20261001`: `d_lineup` beta 0.285 logit per
xG/60; pooled calibration slope 0.985 (95% CI 0.835-1.136), 2025-26 slope
0.903; gain over the home-rate constant 0.0316 / 0.0223 / 0.0143.
L-asof (previous game's lineup as "tonight") is +0.00015 vs the incumbent
(SE 0.00021): the value is in knowing tonight's lineup, so the live feature is
only as good as the DailyFaceoff projection.

(Numbers re-run in review after debut skaters got their boxscore position in
training; the first build had pooled −0.00017 and beta 0.288.)

The goalie swap does not add to `d_goalie_gsax` on the dev folds, so it stays
a candidate column (computed, not used). The gain is within noise: the
evidence is non-inferiority plus no calibration break (owner decision D8),
not a proven improvement. Early-season games (either team ≤ 15 GP) are
slightly worse (+0.0007, 95% CI −0.0011 to +0.0025), descriptive only.

## Files

| File | What | Size |
|---|---|---|
| `mp_skaters.csv.gz` | Compact MoneyPuck season summaries (one row per player-season, 2019-20 on) | ~250 KB |
| `lineups_<season>.csv.gz` | Dressed players per game from the NHL boxscore: game, date, side, team, player id, name, sweater, F/D/G, TOI, starter | ~0.7 MB / season |
| `fasttrack_backtest.json` | Walk-forward gate report (every candidate, per fold) | small |

## Commands (run from `pipeline/`)

```bash
# Historical lineups (one-off, polite ~1.7 rps, resumable; ~1 h for 2022-23..2025-26)
python3 -c "import lineup_adjust as L; ids = L.completed_game_ids([2022, 2023, 2024, 2025]); \
  [L.fetch_lineups([int(f'{s}02{n:04d}') for n in range(1, 1313)] + [g for g in ids[s] if str(g)[4:6] == '03'], s) for s in ids]"
# MoneyPuck summaries (one request per season; add the finished season at rollover)
python3 -c "import lineup_adjust as L; L.build_mp_store([2025])"
# Gate (walk-forward 2023-24..2025-26) and, on a pass, retrain + promote
python3 retrain.py --fasttrack --no-legacy            # report only
python3 retrain.py --fasttrack --promote --no-legacy  # promote when the gate passes
```

Serving (`lineup_adjust.serve_lineup_features`): tonight = DailyFaceoff
projected lines minus players listed out (DFO `injuryStatus` or ESPN Out/IR),
mapped to NHL ids by sweater + last name on the team's stored boxscores, then
by full name in the season's MoneyPuck table. With at least 14 of 18 mapped,
the unmapped (debuts, call-ups) dress as unrated players at their DFO slot's
position, exactly like a debut in training; with fewer, the team's last
dressed lineup is used (L-asof). `train_game_model.py` and `retrain.py`
retrain the live feature set from `game_model_meta.json`, so a plain retrain
keeps `d_lineup` (`train_game_model.py --incumbent-features` for the 8-column
model).

The current season's lineups are topped up gap-driven by `predict_games.py`
(`lineup_adjust.update_current_store`, at most 60 boxscores per run) and
committed by `update_data.yml`.

At season rollover: add the finished season to `mp_skaters.csv.gz`
(`build_mp_store([S])`); `lineups_<S>.csv.gz` already holds the season.
