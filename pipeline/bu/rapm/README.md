# `bu.rapm` and `bu.lineup`: RAPM v2 and the lineup term (M2)

Design: DESIGN.md §3.2 (RAPM v2, priors, aging, eras, validation), §3.7 (TOI, lineups),
§4 (point-in-time protocol), §1.5 (season roles, holdout looks).  Everything runs from
`pipeline/`, reads the lake read-only and writes state to `<lake>/state/rapm` (gitignored,
override with `--out` / `PONYXG_RAPM_DIR`).  Only the small reports that back a model claim
and the per-game feature table are committed (`bu/rapm/out/`, `bu/lineup/out/`).

## Re-run on the full lake

```bash
cd pipeline
# 1. stints (+ xG re-score) for every built lake season; bios fetched once per season
python -m bu.rapm stints   --lake-dir ../data/lake
# 2. tuning + DESIGN §3.2.2 stint-level validation (burn-in = first lake season)
python -m bu.rapm validate --lake-dir ../data/lake --tune 2021,2022 --dev 2023,2024
# 3. daily point-in-time ratings with the tuned setting
python -m bu.rapm asof     --lake-dir ../data/lake
# 4. per-game lineup features, then the walk-forward inside the incumbent
python -m bu.lineup features --lake-dir ../data/lake
python -m bu.lineup evaluate --lake-dir ../data/lake --matrix /tmp/M.pkl   # dev folds only
python -m bu.lineup evaluate --lake-dir ../data/lake --holdout             # ONE 2025-26 look per config
```

Swap the RAPM target to xG v2 with `--xg <dir of parquet with game_id,event_id,xg>` on
`stints`/`validate`/`asof` (the stints cache is keyed on the xG source, so it rebuilds).

## Pipeline

| Step | Module | Notes |
|---|---|---|
| xG | `xg.py` | v1 = `xg_model_xgb.pkl` re-scored on lake shots with its own features (in-sample for 2022-26: a target, not a predictor); flurry adjustment `xg * prod(1 - xg_prev)` within 3 s same-team sequences |
| Stints | `stints.py` | boundaries = shift starts/ends + faceoffs + goals; shots/goals on `(start, end]`, faceoff zone opens the stint at `t`; goalies separate; all strengths kept (EV, PP/PK, EN) with counts; games whose shift charts disagree with `situationCode` on > 10% of shots are excluded from the regression (138 games of 2019-20) |
| Design | `design.py` | two rows per EV stint (5v5/4v4/3v3, both goalies in); O and D column per skater; covariates home, score (7), P3 lead/trail shell, zone start, 4v4/3v3, back-to-back; 2020-21 rows at weight 0.5 |
| Solver | `ridge.py` | generalized ridge `(X'WX + L) b = X'Wy + L b0`; exact Cholesky (~2,000 columns per season), exact posterior variances |
| Priors | `priors.py`, `aging.py` | Kalman-style chain: prior = last posterior + aging delta, variance `min(kappa^gap var_post + extra_age, v_new)`; rookies at the first-season mean of their position group x draft tier; aging = quadratic delta method on standalone season ratings with drop-outs imputed at replacement level; all fitted on seasons < S |
| Ratings | `asof.py` | one row per (game date, skater): games up to `d - 2 days` (shift REST lag); exact SDs weekly; `max_source_date` stored and asserted |
| Validation | `validate.py` | §3.2.2: 7 as-of dates per season, next-30-day weighted MSE of stint xG/60 vs team-only, no-prior RAPM, prior-only; hyper-parameters tuned on the tuning seasons only |
| TOI | `lineup/toi.py` | shrunk EWMA (half-life 8 games, 2 pseudo-games of slot prior), lag 2 days, F->3 / D->2 |
| Lineup term | `lineup/features.py` | team xGF60/xGA60 from tonight's dressed 18 (L-actual), net and baseline-relative delta, coverage gate 14/18 |
| Game level | `lineup/evaluate.py` | incumbent `train_game_model.walk_forward` with and without the lineup columns; dev folds pick the variant; one logged holdout look |

## Results (lake 2010-11 .. 2025-26, xG v1 target, 2026-10-01)

**Stint level (DESIGN §3.2.2, `out/rapm_validation.json`).** Burn-in 2010-11; tuning 2021-22 +
2022-23 picks `v_new = 0.02`, `kappa = 1.5` (each tuning season alone picks the same point).
Next-30-day weighted MSE of stint xG/60, RAPM v2 minus baseline (z, game-clustered):

| Fold | vs team-only (a) | vs no-prior RAPM (b) | vs prior-only (c) |
|---|---|---|---|
| 2023-24 dev | -0.2224 (-14.7) | -0.1024 (-9.0) | -0.0424 (-6.8) |
| 2024-25 dev | -0.2189 (-13.7) | -0.1038 (-8.7) | -0.0360 (-5.9) |

Gate PASS; RAPM v2 also wins against all three in each of the 15 seasons 2011-12 .. 2025-26.
Ablations: the rookie mean helps (2024-25 z 3.0); the aging curve is not significant on the
dev folds (z -1.3 / 0.0) and helps on 2025-26 (z 2.6); both are kept as designed.

**TOI shares** (`../lineup/out/toi_validation.json`): MAE 0.0323 vs 0.0403 for "last game's share".

**Game level, lineup term as a feature of the incumbent** (`../lineup/out/lineup_eval.json`),
Δ log loss vs `train_game_model` walk-forward on the same games (negative = better):

| Fold | n | Δ LL | SE | Role |
|---|---|---|---|---|
| 2023-24 | 1,399 | -0.00029 | 0.00141 | dev |
| 2024-25 | 1,206 | -0.00382 | 0.00113 | dev |
| 2025-26 | 1,394 | -0.00254 | 0.00162 | soft holdout, single logged look (`look_log.jsonl`) |
| pooled | 3,999 | -0.00214 | 0.00082 | |

Candidate `bu_d_net + bu_d_delta` (chosen on dev). Dev A2 passes; calibration slope CIs contain 1.
The holdout A-comp test (one-sided 98.75% upper bound < +0.0005) does **not** pass
(+0.0011): the point estimate is favourable but the look is underpowered, so per DESIGN §1.7 the
term stays in shadow until the pooled re-test with 2026-27 live games.  L-asof (previous game's
18) gives -0.00110 on dev; the degraded-shift sensitivity (35% of games +2 days) -0.00183.
