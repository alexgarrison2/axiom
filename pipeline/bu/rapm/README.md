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
python -m bu.lineup evaluate --lake-dir ../data/lake --holdout             # refused: the one look is taken
# 5. live path: season-start pack (committed, once per season from the full lake)
python -m bu.lineup pack --lake-dir ../data/lake --season 20262027
```

## Live refresh (no historical lake needed)

```bash
cd pipeline
python -m bu.lake.backfill --seasons 2026                       # current season's PBP + shifts only
python -m bu.rapm asof --seasons 2026 --seed bu/lineup/out/season_pack_20262027.json.gz
python -m bu.lineup serve --season 20262027 --publish          # -> bu/lineup/out/serving_bundle.json.gz
```

`asof --seed` refits the season from the pack's chain, aging curve and rookie means; on the
real lake it reproduces the full-chain 2025-26 ratings exactly (max |diff| 0.0, also tested on
synthetic data).  `serve` rolls the pack's TOI-share state and team lineup histories through the
season's games, attaches the current ratings and the NHL-id crosswalk for DailyFaceoff names.
In `predict_games` the integrator calls

```python
from bu.lineup.serve import LiveLineupTerm
term = LiveLineupTerm.load("bu/lineup/out/serving_bundle.json.gz")
f = term.features(home, away, team_lineups.get(home), team_lineups.get(away))
extra_features = {"bu_d_net": f["bu_d_net"], "bu_d_delta": f["bu_d_delta"]}   # 0 when not f["bu_ok"]
```

It never raises; `bu_ok` is False (neutral 0 features, `reason` set) when the bundle is older
than 36 h (DESIGN §3.2.2 `bu_state_freshness`), a team has < 10 mapped skaters or either side
has < 14 rated skaters: the same neutral policy as the walk-forward (`evaluate.attach`).  At
the first game of a season the live term equals the backtest feature row (parity test).
Players DFO marks out / IR / suspended are dropped; game-time decisions are counted as dressed
(DESIGN's 50/50 mix is not implemented).

Swap the RAPM target to xG v2 with `--xg <dir of parquet with game_id,event_id,xg>` on
`stints`/`validate`/`asof` (the stints cache is keyed on the xG source, so it rebuilds).

## Pipeline

| Step | Module | Notes |
|---|---|---|
| xG | `xg.py` | v1 = `xg_model_xgb.pkl` re-scored on lake shots with its own features (in-sample for 2022-26: a target, not a predictor); flurry adjustment `xg * prod(1 - xg_prev)` within 3 s same-team sequences |
| Stints | `stints.py` | boundaries = shift starts/ends + faceoffs + goals; shots/goals on `(start, end]`, faceoff zone opens the stint at `t`; goalies separate; all strengths kept (EV, PP/PK, EN) with counts; games whose shift charts disagree with `situationCode` on > 10% of shots are excluded from the regression (138 games of 2019-20) |
| Design | `design.py` | two rows per EV stint (5v5/4v4/3v3, both goalies in); O and D column per skater; covariates home, score (7), P3 lead/trail shell, zone start, 4v4/3v3, back-to-back; 2020-21 rows at weight 0.5 |
| Solver | `ridge.py` | generalized ridge `(X'WX + L) b = X'Wy + L b0`; exact Cholesky (~2,000 columns per season), exact posterior variances |
| Priors | `priors.py`, `aging.py`, `pack.py` | Kalman-style chain: prior = last posterior + aging delta (one step per season since last rated, indexed by the earlier age), variance `min(kappa^gap var_post + extra_age, v_new)`, precision `sigma2 / var` with `sigma2` per second (divided by the era weight after 2020-21); rookies at the first-season mean of their position group x draft tier; aging = quadratic delta method on standalone season ratings with drop-outs imputed at replacement level; all fitted on seasons < S; the season-start state is saved as a prior pack |
| Ratings | `asof.py` | one row per (game date, skater): games up to `d - 2 days` (shift REST lag); exact SDs weekly; `max_source_date` stored and asserted; per season also the prior of every carried player and the latest (all-games) fit |
| Validation | `validate.py` | §3.2.2: 7 as-of dates per season, next-30-day weighted MSE of stint xG/60 vs team-only, no-prior RAPM, prior-only; hyper-parameters tuned on the tuning seasons only |
| TOI | `lineup/toi.py` | shrunk EWMA (half-life 8 games, 2 pseudo-games of slot prior), lag 2 days, F->3 / D->2 |
| Lineup term | `lineup/features.py` | team xGF60/xGA60 from tonight's dressed 18 (L-actual), net and baseline-relative delta, coverage gate 14/18; a dressed skater without a rating takes his season prior |
| Crosswalk | `lineup/crosswalk.py` | NHL rosters (explicit season id) + lake rosterSpots -> ids for DFO names; `out/crosswalk_coverage.json` |
| Live | `lineup/serve.py` | season pack -> serving bundle -> `LiveLineupTerm` (above) |
| Game level | `lineup/evaluate.py` | incumbent `train_game_model.walk_forward` with and without the lineup columns; dev folds pick the variant; one logged holdout look |

## Results (lake 2010-11 .. 2026-27, xG v1 target, code m2-r3, 2026-10-01)

Era handling: 2020-21 rows at weight 0.5; the 2019-20 on-ice anomalies are handled by dropping
games whose shift charts disagree with `situationCode` on > 10% of shots (138 games; the kept
2019-20 games match on 99.7% of shots), and 2019-20 / 2020-21 get half weight in the aging fit.
Sensitivity (DESIGN §3.2.1): with 2019-21 left out entirely the tuning picks `v_new 0.03,
kappa 1.25`, within one grid step of the main pick, so the main run stands
(`out/rapm_validation_excl_2019_2021.json`).

**Stint level (DESIGN §3.2.2, `out/rapm_validation.json`).** Burn-in 2010-11; tuning 2021-22 +
2022-23 picks `v_new = 0.02`, `kappa = 1.5` (each tuning season alone: v0.03/k1.25 and
v0.02/k1.25, both within one grid step).  Next-30-day weighted MSE of stint xG/60, RAPM v2 minus
baseline (z, game-clustered):

| Fold | vs team-only (a) | vs no-prior RAPM (b) | vs prior-only (c) |
|---|---|---|---|
| 2023-24 dev | -0.2258 (-15.1) | -0.1057 (-9.3) | -0.0403 (-6.6) |
| 2024-25 dev | -0.2215 (-13.9) | -0.1064 (-9.0) | -0.0350 (-5.8) |
| 2025-26 (report) | -0.1919 (-12.3) | -0.0923 (-8.0) | -0.0391 (-5.8) |

Gate PASS; RAPM v2 beats all three in every one of the 15 seasons 2011-12 .. 2025-26.
Ablations at the selected setting (`ablations_at_selected`, MSE without minus with; + = the
component helps): aging curve +0.0036 (z 2.1) 2021-22, +0.0015 (0.9) 2022-23, -0.0007 (-0.5)
2023-24, +0.0018 (1.3) 2024-25, +0.0051 (3.1) 2025-26; rookie mean -0.0005 (-0.7), -0.0014
(-2.0), +0.0006 (1.1), +0.0016 (2.8), +0.0003 (0.6).  The rookie mean is mixed (it slightly hurts
the 2022-23 tuning season); both components are kept as designed.

**TOI shares** (`../lineup/out/toi_validation.json`): MAE 0.0323 vs 0.0403 for "last game's share".

**Game level, lineup term as a feature of the incumbent** (`../lineup/out/lineup_eval.json`):
Δ log loss vs the `train_game_model` walk-forward on the same games (negative = better).
Candidate `bu_d_net + bu_d_delta`, chosen on the dev folds:

| Fold | n | Δ LL | SE | Calibration slope (95% CI) | Role |
|---|---|---|---|---|---|
| 2023-24 | 1,399 | -0.00032 | 0.00149 | 1.01 (0.79-1.22) | dev |
| 2024-25 | 1,206 | -0.00402 | 0.00118 | 1.15 (0.85-1.44) | dev |
| dev pooled | 2,605 | -0.00204 | 0.00097 | 1.06 (0.89-1.24) | A2 PASS |
| 2025-26 | 1,394 | -0.00254 | 0.00162 | 0.91 (0.64-1.17) | soft holdout, the single logged look (`look_log.jsonl`, code m2-r1) |

Early season (GP <= 15) on dev: -0.0034 (SE 0.0025; one-sided upper bound +0.0007 < +0.002, A4).
L-asof (previous game's 18): -0.00113 on dev.  Degraded shifts (35% of games +2 days,
`lineup_eval_degraded.json`): -0.00194, a 0.0001 loss (< the 0.0005 DESIGN §4.3 threshold).

The holdout A-comp test (one-sided 98.75% upper bound < +0.0005) did **not** pass on its single
look (+0.0011: favourable point estimate, underpowered).  The look was taken with code m2-r1;
the review fixes since (aging step, sigma2 guard and era scale, season-prior fallback) cannot be
re-looked at on 2025-26 (one look per component), so their holdout value is unknown.  Pooling
dev and the logged look: -0.0022 (SE ~0.0008, n 3,999).  **Owner decision (2026-10-01): ship on
this pooled evidence, keeping the old version in shadow for rollback; the 2026-27 live games are
the clean re-test.**

**Against the live F1 model** (`../lineup/out/lineup_eval_vs_f1_main.json`, descriptive: main's
`train_game_model` with `d_lineup`, logit-elo-v5-20261001): adding the term on top of `d_lineup`
gives dev Δ -0.00137 (SE 0.00097; 2023-24 +0.00014, 2024-25 -0.00313; A2 passes, early-season
upper bound +0.0029 fails A4), while **replacing `d_lineup` with it gives -0.00183**
(2023-24 -0.00072, 2024-25 -0.00312).  Recommendation for the joint retrain: replace `d_lineup`
with `bu_d_net + bu_d_delta`, and keep F1 in shadow.
