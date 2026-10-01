# `pipeline/bu/xg/`: shot model v2 (xG v2, milestone M1)

Design: DESIGN.md v2 §3.1 (shot model v2), §4.4 (leakage rules), §8 M1 (gate and live wiring). Owner decisions: D3 (MoneyPuck may be used, with credit).

**Status (2026-10-01).** xG v2 beats the incumbent shot model in every one of 15 walk-forward seasons. The M1 gate as a whole has **not** passed, so the site still publishes v1 xG. v2 runs live in **shadow** (`PONYXG_XG=shadow`, the default) so the live-shadow part of the gate starts collecting games now.

## What v2 is

**Unit.** Unblocked attempts (codes 505, 506 and 507) outside the shootout.

**Features** (`features.py`, built from the lake `events` table; live scoring uses the same function):
- **Geometry:** continuous distance and angle, plus x/y in the shooter's attacking frame. The side comes from `homeTeamDefendingSide`, or from the lake's vote where that field is missing (2010-17).
- **Behind-the-net** flag.
- **Rink-adjusted distance:** visitor-shot CDF matching per rink, fit on seasons before S.
- **Shot type.**
- **Shooter handedness and off-wing.** The map is `models/handedness.json`: 3,107 shooters from NHL team rosters for 2010-27, filled in from MoneyPuck. The old `player_hand.json` holds only `"U"` values, so v1's off-wing flag was always 0.
- **Skater and goalie state:** own and opponent skaters, the difference, and extra attacker.
- **Previous event:** type, same team or not, coordinates converted into the current shooter's frame, Δt, distance, speed, angle change, and angle change per second.
- **Rebound:** the same team's attempt within 3 s.
- **Rush:** the previous event came from outside the offensive zone within 4 s.
- **Clocks:** seconds since the last faceoff and since the last change of strength or goalie state.
- **Score state** from the shooter's side, clipped to ±3.
- Period, period seconds, game seconds, home or away, and playoff.

**Model** (`model.py`):
- XGBoost `hist` booster: depth 6, learning rate 0.04, early stopping on a game-grouped slice. Fixed seed and `nthread`.
- **Empty-net shots** get their own logistic on distance and angle.
- **Penalty shots** get a shrunk constant.
- **Storage:** JSON only, with no pickles. The booster is about 1 MB; the side file holds meta, the empty-net model, rink knots and optional Platt maps.

**Training scheme** (`walkforward.py`, chosen on the dev folds only; numbers in `out/xgv2_dev_experiments.json`):
- **Season-start model for season S:** trained on season S-1 only.
  - Scorer practice drifts every season. From 2021-22 to 2025-26 the 5v5 missed-shot share went from 27% to 36%, and the wrist-shot share from 57% to 44%.
  - On the dev folds every older season *hurt*: a 5-season window is 0.003-0.006 worse per shot than S-1 alone, and recency decay beats a flat window.
- **As-of refits:** each later month is scored by a model refit on S-1 plus the games of S played before that month, with the current season at weight 2.
  - Mid-season data helps a lot: -0.0038 per shot in 2023-24 and -0.0006 in 2024-25 versus the season-start model.
- **No future data.** `train_window` never includes S or later seasons, and an as-of block never sees its own games. Tests: `tests/test_xgv2.py`.

**Deviations from DESIGN §3.1, all decided on the dev folds:**
- **No isotonic calibration.** Per-strength isotonic regression on game-grouped out-of-fold predictions made held-out log loss worse on both dev folds (+0.0006 and +0.0004). Per-strength Platt maps were neutral. The shipped model is the raw booster; strength enters it as features. Platt maps are available with `--calibrate`.
- **No 5-season window.** The previous season plus as-of refits replace it, for the reason above.

## Results (walk-forward, `out/xgv2_report.json`)

Every season S is scored by models that never saw S or anything later. The comparison set is unblocked attempts excluding empty-net and penalty shots, with coordinates; every model is scored on exactly the same shots. Lower log loss (LL) is better.

The models compared:
- **v1 PIT** (the M1 bar): the v1 recipe (`xg_model.py`) re-fit on the 5 seasons before S.
- **v1 pkl**: the committed `xg_model_xgb.pkl`, which is *in sample* on 2022-26 (a random 80/20 split) and therefore optimistic there.

| Season | Role | v2 | v2 as-of | v1 PIT | v1 pkl* | Δ as-of − PIT | AUC as-of / PIT | goals/xG as-of |
|---|---|---|---|---|---|---|---|---|
| 2011-12 | – | 0.1978 | 0.1969 | 0.2065 | 0.2144 | -0.0096 | 0.788 / 0.752 | 1.000 |
| 2012-13 | – | 0.2006 | 0.2004 | 0.2088 | 0.2158 | -0.0083 | 0.779 / 0.744 | 1.013 |
| 2013-14 | – | 0.2003 | 0.1994 | 0.2071 | 0.2146 | -0.0077 | 0.781 / 0.752 | 0.993 |
| 2014-15 | – | 0.1984 | 0.1974 | 0.2060 | 0.2135 | -0.0086 | 0.780 / 0.747 | 0.999 |
| 2015-16 | – | 0.1973 | 0.1966 | 0.2043 | 0.2137 | -0.0077 | 0.785 / 0.753 | 0.994 |
| 2016-17 | – | 0.1999 | 0.1990 | 0.2070 | 0.2171 | -0.0080 | 0.781 / 0.750 | 1.004 |
| 2017-18 | – | 0.2053 | 0.2046 | 0.2127 | 0.2212 | -0.0081 | 0.775 / 0.741 | 1.015 |
| 2018-19 | – | 0.2101 | 0.2096 | 0.2177 | 0.2232 | -0.0081 | 0.772 / 0.738 | 1.008 |
| 2019-20 | – | 0.2130 | 0.2110 | 0.2197 | 0.2236 | -0.0087 | 0.771 / 0.739 | 0.952 |
| 2020-21 | – | 0.2119 | 0.2115 | 0.2203 | 0.2250 | -0.0088 | 0.777 / 0.745 | 1.009 |
| 2021-22 | tuning | 0.2188 | 0.2184 | 0.2262 | 0.2311 | -0.0078 | 0.761 / 0.732 | 1.000 |
| 2022-23 | tuning | 0.2232 | 0.2215 | 0.2289 | 0.2267* | -0.0074 | 0.757 / 0.729 | 0.980 |
| 2023-24 | dev | 0.2142 | 0.2104 | 0.2227 | 0.2132* | -0.0122 | 0.780 / 0.733 | 1.023 |
| 2024-25 | dev | 0.2078 | 0.2073 | 0.2203 | 0.2128* | -0.0131 | 0.787 / 0.737 | 0.985 |
| 2025-26 | soft holdout | 0.2144 | 0.2137 | 0.2241 | 0.2183* | -0.0104 | 0.778 / 0.739 | 0.977 |

\* In sample for the v1 pickle.

The game-clustered SE of each per-season paired difference is 0.0003-0.0006, so every Δ above is more than 13 SE from zero.

**MoneyPuck `xGoal`** (benchmark only, credit MoneyPuck.com) on the same shots, joined on game, period, second, shooter and event type; coverage is 99.2-99.8%. LL here covers all unblocked attempts:

| | 2011-12 … 2022-23 | 2023-24 | 2024-25 | 2025-26 |
|---|---|---|---|---|
| MoneyPuck | 0.189-0.215 | 0.2139 | 0.2181 | 0.2226 |
| v2 as-of | +0.007 to +0.012 worse | 0.2135 (-0.0004) | 0.2108 (**-0.0073**) | 0.2178 (**-0.0048**) |

How to read the MoneyPuck comparison:
- MoneyPuck's published `xGoal` comes from a model fit on past data that includes these seasons, so it is an in-sample reference. Its sharp drop from 2023-24 on is consistent with its fit ending around 2022-23.
- On the most recent two seasons, the walk-forward v2 beats it.
- MoneyPuck is not used as a v2 input:
  - its live `xGoal` is not available when the pipeline scores a game;
  - an in-sample `xGoal` would leak into the walk-forward.

## M1 gate (DESIGN §8), `out/xgv2_m1_summary.json`

| Part | Rule | Result |
|---|---|---|
| (a) shot LL | Dev folds: LL ≤ PIT v1 − 0.002 and AUC ≥ v1 | **PASS.** −0.0122 / −0.0131; AUC +0.047 / +0.050. Every season of 2011-26 also passes. |
| (b) goals/xG by strength | Within [0.97, 1.03] for 5v5, 5v4, 4v5, 3v3 and EN on the dev folds | **FAIL** as literally written; every ratio's 95% Poisson CI overlaps the band. The small strengths have SE of 6-10% per season (about 100-250 goals). v1 PIT is much further off: EN 6-7x, 3v3 1.3-1.7, 5v5 0.87. |
| (c) incumbent with v2 xG (`game_gate.py`, `out/xgv2_game_gate.json`) | A2 + A5 on the dev folds; A-comp on the 2025-26 holdout (one look, logged in `out/xgv2_gate_log.jsonl`) | **A2 PASS, A5 PASS, A-comp FAIL** (details below) |
| (d) live shadow | ≥ 100 live games with no calibration break | **Pending.** 2026-27 has 8 games. Shadow logging starts with this change (`python -m bu.xg.summary` reports it). |

**Part (c) in detail**, Δ per game against the incumbent fed PIT xG v1:

| Comparison | Δ | Notes |
|---|---|---|
| Pre-registered candidate `v2_asof`, dev pooled | −0.00118 | 2023-24 −0.00118, 2024-25 −0.00117 |
| `v2_asof`, holdout 2025-26 | −0.00036 | SE 0.00116; one-sided 98.75% upper bound +0.0022, above the +0.0005 margin |
| Season-start v2, holdout 2025-26 (descriptive) | −0.00082 | SE 0.00074 |
| `v2_asof` vs the committed in-sample v1 pickle, dev pooled | −0.00041 | |
| `v2_asof` vs the committed in-sample v1 pickle, holdout | −0.00026 | |

**Verdict.**
- **Not shipped as the published xG.** That follows the workstream rule: wire it in default-on only if the M1 gate passes.
- **Shot level:** a large, consistent win.
- **Game level:** the point estimates favour v2 in every fold, but the 2025-26 holdout cannot establish non-inferiority at the strict A-comp bound with n = 1,394 games.
- **Retest policy (DESIGN §1.7 A1):** 2026-27 live shadow plus a pooled re-test at the end of the regular season. Shadow mode makes that possible.

## Live wiring (`live.py`; hook in `refresh_pipeline.stage_rescore_xg`)

`PONYXG_XG` takes one of three values:

| Value | `xg_raw` (published, contract unchanged) | `xg_raw_v2` (additive column) |
|---|---|---|
| `v1` | `xg_model_xgb.pkl` | not written |
| `shadow` (default) | v1 | xG v2 |
| `v2` | xG v2; v1 only for shots v2 cannot score yet | xG v2 |

How live scoring works:
- **Scoring path:** v2 scores each game from its play-by-play, using the lake copy if present and otherwise one GET per game with unscored shots. The payload goes through the lake parser and `features.shot_features`, the exact training path. A parity test checks live features against training features, with and without shifts and boxscore, and through a parquet round trip.
- **Rescoring:** the manifest records `mode`, `hash`, `v2_signature`, `v1_fallback_games` and `v2_unmatched_events`. Flipping the flag or changing the artifacts rescores the season. Games v2 could not score are retried on the next run. Shots the NHL has since removed from the play-by-play are not retried.
- **Failure handling:** v2 never fails a run. On any error the column stays NaN, and under `v2` the affected shots fall back to v1.

**Checked on 2026-10-01, in this worktree, with the outputs reverted afterwards:**
- Sequence: full (shadow) → lite (shadow) → full (`v2`) → full (`v2`, idempotent, file unchanged) → lite (`v2`) → full (back to shadow).
- Every run exited 0 with every required stage ok, and `validate_outputs.py` reported 0 failed.
- Shadow scored 620 of 621 live shots. The remaining event (2026020005 #201) is no longer in the NHL feed.

## Before flipping to `PONYXG_XG=v2`

1. **Retrain the game model on v2 xG.** `game_model.pkl` was fit on v1 xG distributions (DESIGN §3.1 live wiring, item 2).
   - Give the historical shot files a v2 `xg_raw`, taken from the walk-forward out-of-sample scores (`<state-dir>/oos_xg2_<S>.parquet`, column `xg2_asof`). `features._score_raw_xg` then reads it directly.
   - Retrain `train_game_model.py`. These files are owned by the fast-track workstream.
2. **Shadow check:** ≥ 100 live games with the goals/xG v2 CI containing 1 (`python -m bu.xg.summary`).
3. **Pooled re-test:** the pre-registered A-comp re-test pooled over 2025-26 and 2026-27 at season end (DESIGN §1.7 A1).

## Commands (run from `pipeline/`)

```bash
# Walk-forward report on the whole lake (2010+; ~60 min on 8 cores), MoneyPuck benchmark optional
python -m bu.xg.walkforward --lake-dir ../data/lake --mp-dir <dir of shots_YYYY.zip> --state-dir <scratch>/xg_state
# Game-level gate: dev folds only (re-runnable); the holdout look is spent (out/xgv2_gate_log.jsonl)
python -m bu.xg.game_gate --state-dir <scratch>/xg_state --no-holdout --out <scratch>/game_gate_dev.json
python -m bu.xg.summary                       # M1 verdict incl. live shadow status
# Monthly live refit (as-of): previous season + current season to date -> models/xg2_*.json
python -m bu.lake.backfill --seasons 2026     # bring the lake's current season up to date first
python -m bu.xg.walkforward --lake-dir ../data/lake --production-only [--asof YYYY-MM-DD]
# Handedness: rosters for new seasons (<= 2 rps), MoneyPuck fallback
python -m bu.xg.handedness --lake-dir ../data/lake --seasons 20262027 --fetch --mp-dir <dir>
```

The monthly refit changes `models/xg2_*.json`, so commit it on its own with the validation numbers (CLAUDE.md). The walk-forward as-of rows give those numbers for the same scheme.

## Files

- `features.py`, `model.py`, `rink.py`, `handedness.py`: the model.
- `walkforward.py`: walk-forward, report, gate parts (a) and (b), and the production refit.
- `game_gate.py`: gate part (c).
- `summary.py`: the verdict.
- `v1.py`: v1 inputs rebuilt from the lake, exactly as `scrape_games.py` builds them; tested against the CSVs.
- `moneypuck.py`: the MoneyPuck benchmark.
- `live.py`: pipeline scoring and the flag.
- `out/`:
  - `xgv2_report.json`: per-season metrics, reliability bins, goals/xG by strength, MoneyPuck comparison;
  - `xgv2_dev_experiments.json`: every structural choice, with numbers;
  - `xgv2_game_gate.json` and `xgv2_gate_log.jsonl`: gate part (c) and its look ledger;
  - `xgv2_m1_summary.json`: the verdict.
- `models/handedness.json`.
- Production artifacts: `pipeline/models/xg2_booster.json` and `pipeline/models/xg2_calibrators.json`.

The game-gate run used the 2017-26 lake as it stood before the 2010-16 backfill finished. With the S-1 training scheme those seasons do not change the 2023-26 v2 scores.
