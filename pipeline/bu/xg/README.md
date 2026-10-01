# `pipeline/bu/xg/`: shot model v2 (xG v2, milestone M1)

Design: DESIGN.md v2 §3.1 (shot model v2), §4.4 (leakage rules), §8 M1 (gate and live wiring). Owner decisions: D3 (MoneyPuck may be used, with credit).

**Status (2026-10-01).** xG v2 beats the incumbent shot model in every one of 15 walk-forward seasons. The literal M1 gate has not passed (part (b) is narrower than sampling error, part (c) missed on the single 2025-26 look, part (d) needs live games). **Owner decision 2026-10-01: ship xG v2, together with the RAPM lineup term, on the pooled evidence** (see "Ship decision"), keeping v1 as a shadow for rollback. The flag now defaults to `v2`. An interlock holds an unset flag at `shadow` until the game model is retrained on v2 xG, which the integrator does after merging both workstreams.

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
| (d) live shadow | ≥ 100 live games with no calibration break | **Pending.** 2026-27 has 8 games. `python -m bu.xg.summary` reports it, counting only games after the artifact's training cutoff, with v1 on the same shots. |

**Part (c) in detail**, Δ per game against the incumbent fed PIT xG v1:

| Comparison | Δ | Notes |
|---|---|---|
| Pre-registered candidate `v2_asof`, dev pooled | −0.00118 | 2023-24 −0.00118, 2024-25 −0.00117 |
| `v2_asof`, holdout 2025-26 | −0.00036 | SE 0.00116; one-sided 98.75% upper bound +0.0022, above the +0.0005 margin |
| Season-start v2, holdout 2025-26 (descriptive) | −0.00082 | SE 0.00074 |
| `v2_asof` vs the committed in-sample v1 pickle, dev pooled | −0.00041 | |
| `v2_asof` vs the committed in-sample v1 pickle, holdout | −0.00026 | |

**Verdict on the literal gate.**
- **Shot level:** a large, consistent win.
- **Game level:** the point estimates favour v2 in every fold, but the 2025-26 holdout alone cannot establish non-inferiority at the strict A-comp bound with n = 1,394 games.

## Ship decision (owner, 2026-10-01)

Ship on the pooled evidence (`ship` block of `out/xgv2_m1_summary.json`, computed by `summary.pooled` from the per-season rows of `out/xgv2_game_gate.json`; no new holdout look):

| Pooled 2023-24 + 2024-25 + 2025-26, n = 3,999 games | Δ LL per game | SE | one-sided 98.75% upper bound | A-comp margin +0.0005 |
|---|---|---|---|---|
| `v2_asof` − v1 PIT (the gate's reference) | −0.00089 | 0.00051 | +0.00025 | **pass** |
| `v2_asof` − v1 pickle (in sample, what the site runs today) | −0.00036 | 0.00049 | +0.00074 | miss (descriptive) |

Plus: A2 and A5 pass on the dev folds; the shot-level gain holds in all 15 seasons; goals/xG by strength is consistent with 1 within sampling error everywhere (v1 is off by 0.85-7x).

**Independent re-check (review, 2026-10-01).** The walk-forward was re-run from scratch for 2018-19 … 2025-26 on the full lake: every per-season log loss in the table above reproduced to the last printed digit (it is deterministic), and log loss, AUC and goals/xG recomputed with scikit-learn from the per-shot out-of-sample scores agree. The game-gate dev folds were re-run from those scores (`--no-holdout`) and match `out/xgv2_game_gate.json`. Leakage review: `train_window` never includes S or later; the rink map and the season-start model see only S-1; each as-of block is scored by a refit on S-1 plus S's games strictly before the block; early stopping uses a slice of the training window; score state is the score *before* the event (`bu.lake.parse`); previous-event and clock features look backward only.

**What ships, and what the integrator does** (in this order, one release; DESIGN §3.1 live wiring, items 2-3):
1. Merge this branch and the RAPM branch.
2. `python -m bu.xg.history apply` (from `pipeline/`): appends a v2 `xg_raw` to `nhl_historical_shots.csv` and `nhl_season_2025_2026_shots.csv`, taken from the committed walk-forward out-of-sample scores in `models/xg2_history.csv.gz` (`xg2_asof`; 99.8% of rows, the v1 pickle for the rest, as in a dry run on copies). Every other byte is kept, and `revert` restores the files exactly.
3. Retrain the game model jointly (v2 xG + RAPM lineup term) with `train_game_model.py`. `features.raw_team_game_xg` then reads v2 for 2022-26. One known wrinkle: in the 2023-24 and 2024-25 shot files about 97 third-period shots per season are empty-net shots that the old scraper labelled `5v5`/`5v4` (the lake knows they are EN; their goal rate is 49%). `raw_team_game_xg` filters EN by the file's `strength_state`, so they stay in the "non-EN" sums. v1 gave them ordinary xG of about 0.07; v2 gives them about 0.55. Under v2 the goals and the xG of those shots agree, so goalie GSAx is less distorted than under v1, but it is a small difference from the game gate, which excludes them using the lake's strength.
4. Add `"xg_version": "v2"` to `game_model_meta.json` (`train_game_model.py` should write it). This releases the interlock: the next pipeline run resolves the unset flag to `v2`, sees the hash change, and rescores the current season's `xg_raw` with v2 while keeping v1 in `xg_raw_v1`.
5. Commit the retrain on its own with its validation numbers (CLAUDE.md).

**Rollback:** set `PONYXG_XG=v1` in the workflow (or `shadow`). `xg_raw` is re-taken from v1 on the next run, and `xg_raw_v1` is dropped. Then run `python -m bu.xg.history revert` and restore the previous `game_model.pkl` and `game_model_meta.json` from git.

**Still tracked after shipping:** gate (d) live shadow (≥ 100 out-of-sample games with goals/xG and calibration-slope CIs containing 1, now also reported against v1 on the same shots), and the pre-registered pooled A-comp re-test over 2025-26 plus 2026-27 at season end (DESIGN §1.7 A1).

## Live wiring (`live.py`; hook in `refresh_pipeline.stage_rescore_xg`)

`PONYXG_XG` takes one of three values:

| Value | `xg_raw` (published, contract unchanged) | `xg_raw_v2` (additive column) |
|---|---|---|
| `v1` | `xg_model_xgb.pkl` | not written |
| `shadow` | v1 | xG v2 |
| `v2` (default) | xG v2; v1 only for shots v2 cannot score yet | xG v2, plus `xg_raw_v1` (v1's score of every shot, the rollback shadow) |

**Interlock.** An unset (or invalid) `PONYXG_XG` means `v2` only when `game_model_meta.json` has `"xg_version": "v2"`; otherwise it means `shadow`, and the run prints why. An explicit value always wins, so `PONYXG_XG=v2` forces v2 and `PONYXG_XG=v1` rolls back.

How live scoring works:
- **Scoring path:** v2 scores each game from its play-by-play, using the lake copy if present and otherwise one GET per game with unscored shots. The payload goes through the lake parser and `features.shot_features`, the exact training path. A parity test checks live features against training features, with and without shifts and boxscore, and through a parquet round trip.
- **Rescoring:** the manifest records `mode`, `hash`, `v2_signature`, `v1_fallback_games`, `v2_unmatched_events` and, under v2, `v1_shadow_hash`. Flipping the flag or changing the artifacts rescores the season. Games v2 could not score are retried on the next run. Shots the NHL has since removed from the play-by-play are not retried.
- **Failure handling:** v2 never fails a run. On any error the column stays NaN, and under `v2` the affected shots fall back to v1.

**Checked on 2026-10-01, in this worktree, with the outputs reverted afterwards:**
- Sequence: full (shadow) → lite (shadow) → full (`v2`) → full (`v2`, idempotent, file unchanged) → lite (`v2`) → full (back to shadow).
- Every run exited 0 with every required stage ok, and `validate_outputs.py` reported 0 failed.
- Shadow scored 620 of 621 live shots. The remaining event (2026020005 #201) is no longer in the NHL feed.

## Commands (run from `pipeline/`)

```bash
# Walk-forward report on the whole lake (2010+; ~60 min on 8 cores), MoneyPuck benchmark optional
python -m bu.xg.walkforward --lake-dir ../data/lake --mp-dir <dir of shots_YYYY.zip> --state-dir <scratch>/xg_state
# Game-level gate: dev folds only (re-runnable); the holdout look is spent (out/xgv2_gate_log.jsonl)
python -m bu.xg.game_gate --state-dir <scratch>/xg_state --no-holdout --out <scratch>/game_gate_dev.json
python -m bu.xg.summary                       # M1 verdict, ship block (pooled evidence), live shadow status
# v2 xg_raw for the historical shot files the game model trains on (see "Ship decision")
python -m bu.xg.history export --state-dir <scratch>/xg_state   # walk-forward OOS -> models/xg2_history.csv.gz
python -m bu.xg.history apply|revert|status
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
- `live.py`: pipeline scoring, the flag, its interlock and the v1 rollback shadow.
- `history.py`: v2 `xg_raw` for the historical shot files (`export`, `apply`, `revert`, `status`).
- `out/`:
  - `xgv2_report.json`: per-season metrics, reliability bins, goals/xG by strength, MoneyPuck comparison;
  - `xgv2_dev_experiments.json`: every structural choice, with numbers;
  - `xgv2_game_gate.json` and `xgv2_gate_log.jsonl`: gate part (c) and its look ledger;
  - `xgv2_m1_summary.json`: the verdict.
- `models/handedness.json`.
- Production artifacts: `pipeline/models/xg2_booster.json` and `pipeline/models/xg2_calibrators.json`.
- `pipeline/models/xg2_history.csv.gz`: walk-forward out-of-sample `xg2_asof` per shot for the seasons in the historical shot files (2022-23 … 2025-26).

The game-gate run used the 2017-26 lake as it stood before the 2010-16 backfill finished. With the S-1 training scheme those seasons do not change the 2023-26 v2 scores.
