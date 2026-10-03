# `bu.rapm` and `bu.lineup`: RAPM v2, ratings v3 and the lineup term (M2)

Design: DESIGN.md §3.2 (RAPM v2, priors, aging, eras, validation), §3.7 (TOI, lineups),
§4 (point-in-time protocol), §1.5 (season roles, holdout looks).  Everything runs from
`pipeline/`, reads the lake read-only and writes state to `<lake>/state/rapm` (gitignored,
override with `--out` / `PONYXG_RAPM_DIR`).  Only the small reports that back a model claim
and the per-game feature table are committed (`bu/rapm/out/`, `bu/lineup/out/`).

**Shipped (2026-10-01, owner decision): RAPM v2 on the xG v2 target, as the lineup term of the
live game model** (`logit-elo-v5-20261001-xg2-rapm`: `bu_d_net + bu_d_delta` replace the F1
`d_lineup`; `pipeline/bu/README.md` "Live").  The xG v1-target results below are kept for the
record; their reports are archived in `out/xgv1/` and `../lineup/out/xgv1/`.

## Ratings v5 (2026-10-03): the v4 impact, audited (penalties, finishing)

Why: v4 passed 19 / 21 sanity checks; both failures were Rantanen (+0.6 goals / 82, 245th).  Owner
rule: tune nothing to move one player; audit the structure and fix what is wrong, test-gated.
Pre-registered in `v5_prereg.json` (committed before any v5 scoring), results in
`out/v5_validation.json`, the single holdout look in `out/v5_look_log.jsonl`.  **No rating changed**
(EV / PP / PK RAPM, SPM, FIN, TOI): every change is an impact-only term, so the lineup term, game
model and simulator inputs are identical (checked column by column against the v4 pack).

**Audit** (Rantanen, 2026-27 season start): his lake PBP matches the NHL stats API exactly in every
season 2015-26 (taken, minors, majors, misconducts, drawn; no duplicates; fights and misconducts
already 0).  His +0.6 = EV OFF +2.15, PP +1.37, EV FIN -0.33, drawn +1.05 / EV DEF -1.66 (on-ice xGA
relative +0.23 / 60), taken -1.94; 47% of his D90 weight is 2025-26 (64 games, 16 EV goals); SPM
prior +0.214 = role mean 0.056 + box score 0.158 (ixG, primary assists, PP primary assists, EV
minutes; rebounds created -1 SD).  Structural problems found: (1) coincidental / offsetting minors
(~20% of penalties) counted as power-play units, and (2) the goal value per unit (0.153) had them
in its denominator and left out PP goals scored with the goalie pulled.

**Changes** (rule: dev pooled better, holdout not worse by > 2 SE):

| | tuning pick | dev (paired) | holdout 2025-26 | shipped |
|---|---|---|---|---|
| goal value per PP-creating unit (`box.pp_units`: equal-duration penalties cancel, then minute netting; washed-out delayed minors 0) | definitional | - | - | 0.183 (2025-26; NHL (PPG - SHGA) / PPO 0.184) |
| drawn / taken shrinkage | 800 / 400 min (was 400 / 400) | deviance -51.6 (z -1.6) | -40.7 (z -1.8) | yes |
| penalty rate basis (owner amendment A1, after the holdout look) | 800 / 400 re-checked on tuning only | - | - | every penalty, scaled per position to PP-creating units |
| EV FIN in `off_impact` (next-30-game EV stint **goals** MSE) | - | -0.0172 (z -2.9) | -0.0231 (z -3.1) | kept |
| PP FIN (`fin_pp`, shared EV+PP multiplier, prior 30 xG) | best of 8 + none | PP goals MSE -0.122 (z -1.3) | -0.051 (SE 0.11) | yes |
| on-ice goals-above-xG residual RAPM blend | v_r 0.003 | +0.0069 vs FIN-only | +0.011 | no |

Amendment A1 (labelled post-holdout in `v5_prereg.json`): the PP-unit-only rates predicted the
next-30-game net penalty differential worse than all-penalty rates rescaled to the PP level (z 2.3
tuning, 0.3 dev, 2.8 holdout), so the owner chose the all-penalty basis; the t0 re-check on the
tuning seasons kept 800 / 400.  Repeatability (PP units, descriptive): split-half 0.49 drawn / 0.36
taken, next season 0.65 / 0.59.

**Result** (2026-27 as of 2026-10-02): 19 / 21 sanity checks as in v4; Rantanen +0.12 (269th): his
penalty term moves -0.89 -> -1.00 (the higher value outweighs the units fix) and his PP finishing
is slightly below average (`fin_pp` -0.04).  Correlation of impact with v4 0.996; biggest moves
come from PP finishing (Draisaitl +2.7, Caufield +1.5, Hertl -1.7).

**Code**: `v5.py` (penalty rates, PP finishing sums / values), `box.py` (`pp_units`, `pdu_all` /
`ptu_all`, `pp_goal_value.value_pp`, BOX_VERSION 2), `v4_pack.py` (v5 config, grid `fin_pp` sums,
live `fin_pp`), `v5_validate.py` (penalty rows, goal-target designs and scoring),
`ratings_export.py` (`fin_pp` column and impact term).  The season pack must be rebuilt at the
rollover with `python -m bu.rapm.v4_pack pack` (a v4 pack without `pen_units` keeps v4's impact).

## Ratings v4 (2026-10-03): v3 + a box-score (statistical plus-minus) prior

Why: v3 still ranked Kiviranta (+0.9) above Rantanen (-0.5) and Makar 199th.  On-ice RAPM cannot
split credit between players who share most of their ice time (Rantanen 81% of his EV time with
MacKinnon in 2023-24, 73% with Johnston in 2025-26), and v3 used no individual production, so a
low-event fourth liner was credited by default.  v4 is the RPM / EPM remedy, pre-registered in
`v4_prereg.json` before any dev / holdout look (one 2021-22 pilot set the grids).

**Model** (`box.py`, `v4.py`): per player-game individual counts from the lake play-by-play, split by
the player's own manpower state (EV: goals, primary / secondary assists, individual xG v2,
unblocked and all attempts, rebounds and rush attempts created, blocks, takeaways, giveaways,
hits, faceoffs won / lost; PP: goals, assists, ixG, attempts; PK: blocks, takeaways; all
situations: penalties drawn / taken; usage: EV / PP / PK minutes per game), weighted with the same
D90 game recency as the stints, shrunk to the position rate with `t0` pseudo minutes and
standardised within F / D.  Each RAPM component's prior mean is `role mean + z' beta`, with `beta`
(per feature, component and position group, ridge `v_beta`) fitted JOINTLY with the players in the
stage-1 ridge on the stint outcomes (no two-step regression on shrunken RAPM estimates).  In
season the prior mean follows the box score (`b0 += beta' (z(pre + season) - z(pre))`).
Penalties enter the impact directly: `82 x pen_value x all-situation minutes x (pd60 - m) - (pt60 - m)`
(`pen_value` = league net PP goals per penalty unit of the last season, 0.153 for 2025-26), drawn in
`off_impact`, taken in `def_impact`.

**Selection** (tuning 2019-23 only, `out/v4_validation.json`): `v_beta 1e-4`, `t0 150` min,
`v_o 0.01` (the grid edge; 0.005 scored worse), `v_d 0.02`; PP / PK `v_pp 0.04`, `v_pk 0.08`,
`v_beta_st 3e-4`; penalty pseudo minutes 400 (Poisson deviance; also best on dev and holdout).
Calibration slopes 0.98 / 1.01 (EV), 1.06 / 1.13 (PP) -> impact weights 1.

Next-30-game EV stint MSE, minus v3 (D90) on the same rows (paired, date-clustered SE):

| | tuning 2019-23 | dev 2023-25 | holdout 2025-26 (single logged look) |
|---|---|---|---|
| **v4** | **-0.0138 (0.0018)** | **-0.0051 (0.0024)** | **-0.0122 (0.0033)** |
| v2 window (shipped before v3) | +0.0029 | +0.0071 | +0.0086 |
| Kalman chain | -0.0098 | -0.0105 | -0.0049 |
| v4 next-season MSE | -0.0145 | -0.0069 | -0.0162 (z -4.9) |
| v4 PP MSE vs v3 PP / PK | -0.189 (z -6.8) | -0.116 (z -2.7) | -0.181 (z -2.9) |

Dev seasons: 2023-24 -0.0025 (0.0036), 2024-25 -0.0077 (0.0030); every tuning season better.
The ship rule (dev pooled below v3) passes for EV and PP / PK.

**Which individual stats matter** (2026-27 season start, xG/60 per SD, forwards; DEF in the
prevented sign): EV OFF ixG +.049, primary assists +.029, rebounds created +.024, secondary assists
+.020, penalties drawn +.019, EV minutes +.018, giveaways +.018 (a possession proxy), goals +.014,
unblocked attempts +.014, takeaways +.012; blocks -.009, hits -.007.  EV DEF: PK minutes +.024,
hits +.017, takeaways +.015, blocks +.012, goals -.010, PP minutes -.014.  PP OFF: PP ixG +.064,
PP attempts +.048, PP primary assists +.047, PP minutes +.046.  Full table: the bundle's
`v4.meta.spm_coef` / `player_ratings.json` `impact.spm_coef`.

**Sanity list** (a written check, not a target; 2026-27 season start): 19 / 21 pass (v3: 16 / 21).
Fails: Rantanen top 50 (245th, +0.6: EV OFF +.14 but EV DEF -.09 and -0.9 goals of penalties) and
Rantanen in DAL's top 8 (9th).  Makar 24th (v3 202nd); Kiviranta, Faksa, Bäck below DAL's median and
below Rantanen.  MoneyPuck (2024-26): impact vs gameScore / GP 0.789 (v3 0.721), vs points / 60
0.559 (0.494); EV OFF vs 5on5 rel xGF/60 0.768 (0.761); EV DEF vs rel xGA/60 prevented 0.651 (0.675).

**Game level** (`../lineup/out/retrain_v4.json`, look in `../lineup/out/look_log.jsonl`): the live
feature set on the lineup table rebuilt from v4 (`lineup_features_v4.csv.gz`) vs the live model:
dev pooled -0.00035 (SE 0.00056; 2023-24 -0.00045, 2024-25 -0.00023), 2025-26 +0.00079 (SE 0.00122)
<= +0.0010: the owner rule passes (pooled 2023-26 +0.00005, i.e. neutral), so it was promoted:
`logit-elo-v5-20261003-xg2-rapm-fin-r4` (the v4 table is now `lineup_features.csv.gz`, the v2 one
`lineup_features_v2.csv.gz`; the replaced model is kept in `models/shadow/game_model_rapm_fin.pkl`).
It is served from the bundle's `v4` table because its meta says `bu_lineup.ratings = "v4"`
(`LiveLineupTerm(ratings=...)`; on this season's 8 table games the live term tracks the table's
`bu_d_net` at r 0.976, FIN at 0.982, vs 0.966 / 0.09 when served from the v2 tables).  Rollback:
copy the shadow model over `game_model.pkl` / `game_model_meta.json` (or restore them from git).

**Commands** (from `pipeline/`):

```bash
# season rollover (full lake, after `bu.rapm asof` through S): the committed v4 season pack
python -m bu.rapm.v4_pack pack --season 20262027 --xg <asof xG source> --out <RAPM state>
#   -> bu/lineup/out/ratings_pack_v4_20262027.json.gz (v3 pack + SPM coefficients / standardisation / box sums)
# daily: bu.lineup serve -> bundle "v4" table (v3 columns + spm_o/d/pp/pk, pd60, pt60; meta.pen_value,
#        spm_coef) -> bu.lineup.ratings_export -> public/data/player_ratings.json (version 4)
# validation: bu.rapm.v4_validate.run_candidate (v3_validate scoring), out/v4_validation.json,
#   the stint look: out/v4_look_log.jsonl; game model: retrain.py --ratings-v4 <table> [--promote]
```

## Ratings v3 (2026-10-02): game recency, OFF / DEF shrinkage, per-game impact

Owner decisions 2026-10-02 after the DAL audit (Kiviranta 3rd on DAL by NET from 23 h on COL's
fourth line, Rantanen ~0, DEF repeatability 0.41 vs OFF 0.57 and DEF over-dispersed ~25%):
recency is counted in **games**, not seasons ("I really don't care about four seasons ago"), and
the site's headline is a **per-game impact** in goals per 82 games, like The Athletic's Net
Rating.  Pre-registered rules: `v3_prereg.json` (committed before any dev / holdout run, two
amendments before them); every number below: `out/v3_validation.json`.

**Model** (`v3.py`, `recency.py`, `v3_pack.py`):

* *Recency* (`recency.Recency`): an observation's weight depends on how many games ago it was
  played on the league clock (`league_index`: league-average team games, by date; summers add
  nothing, a playoff night counts at its league average).  One weight per date, so a stint with
  ten skaters from two teams has one weight and every Gram is additive by date.  Candidates:
  5 x 30-game blocks (five step patterns) and per-game decay (half-lives 40 / 60 / 90), all with
  weight exactly 0 past 246 games (three 82-game seasons).
* *Shrinkage*: separate prior variances for OFF (`v_o`) and DEF (`v_d`), and a role-aware prior
  mean: each player's OFF and DEF are his role's mean plus his own effect, roles = position group
  x EV-usage tier (EV minutes per weighted game: F < 11 / 11-13 / 13-15 / 15+, D < 16 / 16-18.5 /
  18.5+), or position x draft tier under 10 weighted games; role means fitted jointly (ridge
  `v_role`).  Ratings are re-centred so the data-weighted average skater is 0 (the intercept and
  strength terms absorb it exactly).
* *PP / PK*: one row per 5v4 / 5v3 / 4v3 stint (PP side's xG/60): `PP` column of each PP skater,
  `PK` column of each PK skater, position-group means, `v_pp` / `v_pk`, the same recency.
* *FIN*: `finishing`'s gamma-Poisson formula on recency-weighted sums (`fin_pre` / `fin_in`).
* *Expected TOI per game* by state: EWMA over the player's own games (half-lives tuned per
  state), 3 pseudo-games of the position mean.
* *Two stages*, so the live refresh needs no earlier season: the pre-season prior (every stint
  before the season at weight `w(g + games ago at season start)`) on a grid of in-season games
  `g` (every 5), interpolated, and this season's stints at their exact weights up to `d - 2`
  days.  The backtest runs exactly this computation; the season pack
  `../lineup/out/ratings_pack_<S>.json.gz` carries the grid (1.5-1.7 MB), and the pack -> live
  path reproduces the engine to 5e-8.

**Validation** (primary: next-30-game EV stint MSE, as-of points every 10 games from 0 to 50,
covariates refit on the test rows, Gram-exact; paired SEs clustered by date):

| Model | tuning 2019-23 | dev 2023-25 | holdout 2025-26 (one look) | OFF / DEF slope (dev) |
|---|---|---|---|---|
| **D90** (shipped: decay, half-life 90 games, 0 past 246) | -0.0029 (0.0015) | **-0.0071 (0.0022)** | **-0.0086 (0.0033)** | 1.03 / 0.96 |
| B_geo (best 5 x 30 block: 1 / .7 / .49 / .343 / .24) | +0.0037 (0.0020) | +0.0038 (0.0029) | +0.0040 (0.0046) | 1.00 / 0.88 |
| Kalman chain (benchmark, pre-window) | -0.0127 (0.0021) | -0.0177 (0.0029) | -0.0135 (0.0040) | 1.01 / 0.89 |
| window (benchmark, shipped v2) | 0 | 0 | 0 | 0.95 / 0.79 |

MSE minus the shipped window's (negative = better; SE clustered by date).  D90 minus B_geo:
-0.0066 (SE 0.0012) tuning, -0.0109 (0.0016) dev, -0.0125 (0.0025) holdout.  The pre-registered
rule picked D90; the owner, offered both before the holdout look (amendment 2), chose D90.
Effective weights for a player who plays every game: D90 last 82 games 55%, 82-164 back 29%,
164-246 back 16%, older 0 (games-ago bands 0-30 24%, 30-60 19%, 60-90 15%, 90-120 12%,
120-150 10%); B_geo 74% / 26% / 0.  Other components:

* shrinkage (tuning): v_o 0.03, v_d 0.025, role means for OFF and DEF with a strong ridge
  (v_role 0.001; a weak one left DEF over-dispersed, slope ~0.72); the window's DEF slope 0.79
  (dev) becomes 0.96;
* PP / PK: v_pp 0.16, v_pk 0.08 (the first grid's corner; widened before any dev run), PP
  next-30-game slopes 1.07 / 1.19 tuning, 0.86 / 0.81 dev, 0.96 / 0.78 holdout;
* FIN: prior 30 xG on the D90 weights (beats 60 by 4.2e-5 log loss per shot, SE 1.4e-5, on the
  tuning seasons; 1.2e-5 (1.8e-5) dev, 4.5e-5 (2.6e-5) holdout); the v2 FinState counted every
  season since 2010-11 equally (DECAY 1.0);
* expected TOI: EWMA half-life 10 (EV), 20 (PP), 10 (PK) player games; next-30-game RMSE 1.39 /
  0.56 / 0.47 minutes (dev);
* impact weights: OFF / DEF slopes 1.05 / 0.98 inside [0.85, 1.15] -> equal weights.

**Game model: not changed.**  The lineup term rebuilt from v3 (`bu_d_net`, `bu_d_delta`,
`bu_d_fin` from v3 ratings, `python3 retrain.py --ratings-v3 <table> --no-holdout`) against the live
`logit-elo-v5-20261002-xg2-rapm-fin` on the dev seasons: D90 +0.00014 (SE 0.00042), B_geo +0.00010
(SE 0.00058) log loss per game - the owner rule (dev pooled better) fails, so no game-model holdout
look was taken and the serving bundle's `players` / `fin` tables stay RAPM v2 / FIN v2.  v3 lives
in the bundle's `v3` table and the site's `player_ratings.json`.

**Credibility** (2026-27 as of 2026-10-01): Kiviranta 229th by impact (v2 NET 100th), Caufield
50th (237th), Gallagher 255th (69th), McDavid 9th, MacKinnon 3rd, Draisaitl 2nd, Q. Hughes 1st;
still weak: Makar 202nd (EV OFF -0.16 vs the D average) and Rantanen 329th.  Weighted correlation
with MoneyPuck 5on5 2024-26 relative xGF/60: 0.76 (v2 0.78), relative xGA/60 prevented 0.68 (0.69).

**Impact** (`bu.lineup.ratings_export.impact`):

    impact_82  = off_impact + def_impact                     (goals per 82 games)
    off_impact = 82 [k EV/60 (ev_off - m) + k PP/60 (pp_off - m) + EV/60 (fin - m)]
    def_impact = 82 [k EV/60 (ev_def - m) + k PK/60 (pk_def - m)]

with EV / PP / PK the expected minutes per game, `k` the league EV goals per xG of the last
completed season and `m` the TOI-weighted mean of each rate among rated roster skaters of the
same position group (F / D): an average player at his position is 0 whatever his minutes.  The
pre-registered weighting rule (OFF and DEF weighted by their calibration slopes unless both lie
in [0.85, 1.15]) gave equal weights.  `sd`: posterior SD from the EV and PP / PK rating
variances (TOI and FIN taken as known).

**Commands** (from `pipeline/`):

```bash
# season rollover (full lake, after `bu.rapm asof` through S): the committed season pack
python -m bu.rapm.v3_pack pack --season 20262027 --xg <asof xG source> --out <RAPM state>
#   -> bu/lineup/out/ratings_pack_20262027.json.gz
# daily: bu.lineup serve (bu_refresh.yml) rolls it through the season's games -> bundle "v3" table
#        -> bu.lineup.ratings_export -> public/data/player_ratings.json (version 3)
# validation (scripts of the run: the committed report out/v3_validation.json, looks: out/v3_look_log.jsonl)
#   bu.rapm.v3_validate.run_candidate / mse_table / paired / pooled_slopes
```

## Re-run on the full lake (xG v2 target, as shipped)

```bash
cd pipeline
L=../data/lake; O=<state dir>; X=<scratch>/xg_v2
# 0. the xG v2 target: one season=S.parquet per lake season from the bu.xg walk-forward state
#    (OOS xg2_asof; burn-in 2010-11 scored by the fold fit on it; 2026-27 by the live artifacts)
python -m bu.rapm.v2_source --lake-dir $L --state-dir <bu.xg walk-forward state> --out $X
# 1. stints (+ xG) for every built lake season; bios fetched once per season
python -m bu.rapm stints   --lake-dir $L --out $O --xg $X --seasons 2010-2026
# 2. tuning + DESIGN §3.2.2 stint-level validation (burn-in = first lake season)
python -m bu.rapm validate --lake-dir $L --out $O --xg $X --seasons 2010-2025 --tune 2021,2022 --dev 2023,2024
# 3. daily point-in-time ratings with the shipped setting (window prior, owner directive
#    2026-10-01; through the current season: its prior pack)
python -m bu.rapm asof     --lake-dir $L --out $O --xg $X --seasons 2010-2026 --hyper bu/rapm/out/rapm_validation_window.json
# 3b. finishing-talent season pack for the player ratings export
python -m bu.rapm.finishing pack --lake-dir $L --out $O --xg $X --season 20262027
# 4. per-game lineup features, then the walk-forward inside the incumbent
python -m bu.lineup features --lake-dir $L --out $O --seasons 2010-2026
python -m bu.lineup evaluate --lake-dir $L --out $O --matrix /tmp/M.pkl   # dev folds only
# 5. live path: season-start pack (committed, once per season from the full lake)
python -m bu.lineup pack --lake-dir $L --out $O --season 20262027
# 6. joint game-model retrain against the live model (xG v2 inputs + this term)
python3 retrain.py --joint --no-legacy [--promote]
```

## Live refresh (no historical lake needed; CI: `.github/workflows/bu_refresh.yml`)

```bash
cd pipeline
python -m bu.lineup.refresh --lake-dir <runner-local lake> [--dry-run]
# = python -m bu.lake.backfill --seasons 2026 --endpoints pbp,boxscore,shifts   (gap-driven)
#   python -m bu.rapm asof --seasons 2026 --seed bu/lineup/out/season_pack_20262027.json.gz --xg v2
#   python -m bu.lineup serve --season 20262027 --seed <pack>   -> publish when changed or > 12 h old
```

`--xg v2` scores the current season's lake shots with the live xG v2 artifacts
(`pipeline/models/xg2_*.json`, the training feature path), the same scores `v2_source` used for
2026-27 in the full chain: on the lake of 2026-10-01 the CI path (empty lake -> backfill of 8
games -> seeded refit) reproduced the full-chain 2026-27 ratings exactly (2,816 players, max
|diff| 0.0) in 16 s.

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

The RAPM target is chosen with `--xg` on `stints`/`validate`/`asof`: `v1` (the pickle),
`v2` (the live xG v2 artifacts) or a directory of `season=S.parquet` with
`game_id,event_id,xg` (the stints cache is keyed on the source, so it rebuilds).

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
| Ratings v3 | `recency.py`, `v3.py`, `v3_pack.py`, `v3_validate.py` | game-recency RAPM (EV OFF / DEF with role means, PP / PK), FIN on the same weights, expected TOI by state; season pack `../lineup/out/ratings_pack_<S>.json.gz`, bundle `v3` table, site ratings (section "Ratings v3") |
| Finishing | `finishing.py` | FIN = shrunk EV goals above xG per 60 from the player's own unblocked shots: gamma-Poisson multiplier `(G + 60) / (X + 60)` on league-scaled xG, times shrunk ixG/60; all seasons equally weighted; point-in-time `FinState` (games up to `d - 2 days`); season-start state `../lineup/out/fin_pack_<S>.json.gz` (`python -m bu.rapm.finishing pack --season S --xg <source>`, once per season next to the lineup season pack) |

## OFF credibility pass (2026-10-01): prior dynamics and finishing

Owner smell test: Brendan Gallagher (23 pts, 1.6 SOG/GP in 2025-26) ranked 11th in OFF (+0.46),
above Cole Caufield (51 goals, +0.34).  Evidence in `out/diagnosis_off_fin.json`,
`out/rapm_validation_prior_dynamics.json`, `out/fin_validation.json` and
`../lineup/out/lineup_eval_rapm_fin.json`.

**Why Gallagher rates high.** He is a real 5v5 xG driver: raw on-ice EV xGF/60 relative to his
team +0.37 (2023-24) and +0.43 (2024-25), no-prior RAPM +0.28 / +0.36 in those seasons, and
MoneyPuck's 3-season 5on5 relative xGF/60 +0.59 (rank 20 of 564; Caufield +0.38).  2025-26 was
weak (rel -0.02, no-prior +0.19 on 14 EV hours), but his season-start prior (+0.52, SD 0.11,
worth 24 EV hours) outweighs it, so the 2025-26 posterior is +0.475 (+0.16 with his own prior
reset).  Linemate collinearity is not the cause (his linemates are average or weak OFF players);
Caufield's credit is split with Suzuki (17-22 shared EV hours a season).

**Prior dynamics: window prior shipped by owner directive** (`out/rapm_validation_window.json`).
The season-start prior is now a fresh ridge fit on the last three seasons' EV stints weighted
1 / 0.5 / 0.25 (S-4 and older: 0), each older season's rows moved forward by the players'
aging steps, ridged to the rookie / position means at `v_new 0.04` (picked on the tuning
seasons among 0.02-0.06), summarised per player as mean + posterior variance
(`priors.window_prior`, `Hyper(window="1,0.5,0.25")`); the in-season update is unchanged and
the season pack / seeded live refit reproduce the full chain exactly.  Cost and gain vs the
Kalman chain it replaces: game level neutral (dev folds, lineup term vs no lineup term on the
live base: -0.00167 vs -0.00153; window minus current -0.00014, SE 0.00037; the owner's ship
threshold was +0.0010), but the stint-level metrics are worse everywhere: next-30-day MSE
+0.016 (tuning, z 5.5), +0.015 (dev, z 5.5), +0.013 (2025-26, z 3.3); next-season MSE +0.026,
+0.024, +0.015 (z 8.6, 8.1, 3.6), and worse in every age bucket (<=24, 25-29, 30-32, 33+) and
prior-strength bucket.  The next-season on-ice bias of 33+ players' O (the prior over-rates
them by -0.024 xG/60 on 2021-26 rows) is only slightly smaller in window mode (-0.020).
Correlation with MoneyPuck's 3-season 5on5 relative xGF/60 rises from 0.790 to 0.804.
Gallagher OFF 0.457 -> 0.340 (11th -> 24th of roster skaters), McDavid 0.763 -> 0.552
(2nd -> 5th; NET 2nd -> 14th).

Before the directive, the Kalman chain's own dynamics were swept (kept for the record): a 180-point grid (`validate.prior_dynamics_grid`: additive
season drift `q_add`, `aging_scale`, `young_old_extra`, `v_new`, `kappa`) scored on the shipped
next-30-day stint MSE and on a new next-season metric (players fixed at the season-start prior,
`next|` models).  The tuning-season best (`q_add 0.001`) gains 0.0004 on the 30-day MSE (z -0.65)
but is worse on the next-season metric (tuning +0.0008, dev +0.0007, 2025-26 +0.0038, z 3.9)
and on the 2025-26 30-day MSE (+0.0021); the per-season stability check fails, so DESIGN §3.2
keeps the more regularised Kalman setting.  Stronger aging and wider age-tail variance are
worse everywhere.  The looser chain would move Gallagher *up* (+0.505), since his strong
2023-25 seasons then count for more.  At game level the looser candidate is -0.00017 (SE 0.00010)
vs current on the dev folds: too small to override the stint-level loss.

**Finishing (FIN).**  RAPM OFF is an xG impact by design, so it ignores finishing.  FIN is tuned
on held-out shot log loss (tuning seasons, one-SE rule: `PRIOR_XG 60`, no season decay) and
improves every season's shot LL vs xG alone (z -5.8, -4.4 tuning; -2.1, -2.8 dev; -2.6 2025-26).
Gallagher has the 5th-worst FIN of all skaters with 20+ EV hours (-0.145 goals/60), Caufield
the 11th best (+0.172).  `public/data/player_ratings.json` gains `fin` and `off_total = off + fin`
(existing fields unchanged; DEF keeps the v2 "xG prevented" sign): with the window prior
Gallagher 0.195 (93rd of roster skaters), Caufield 0.472 (14th).  Against MoneyPuck (goals
included: rel xGF/60 + GAx/60) the correlation rises from 0.725 (OFF) to 0.794 (OFF_total) on
the Kalman chain, 0.815 with the window prior.  Game level (dev folds, live features without
the lineup term as the base): adding the team FIN term `bu_d_fin` to `bu_d_net + bu_d_delta`
gives -0.00058 (SE 0.00040; 2023-24 -0.00067, 2024-25 -0.00048) on the Kalman ratings and
-0.00058 on the window ratings (window + FIN vs Kalman without: -0.00072), which passes the A2
dev rule.  **Live since 2026-10-02** (owner approval): `bu_d_fin` is in the serving bundle /
`LiveLineupTerm` and the game model `logit-elo-v5-20261002-xg2-rapm-fin`
(`retrain.py --fin`, the M3 component's single 2025-26 look logged in `look_log.jsonl`); see
`pipeline/bu/README.md` "FIN in the game model".

`lineup features` and the serving bundle now read the stints cache whatever xG source built it
(`data.cached_stints`): with the old default `ensure_stints(paths, s)` (source `v1`) they rebuilt
the cache that `asof --xg v2` had just written, re-scoring every season with the v1 pickle.

## Results on the xG v2 target (as shipped; lake 2010-11 .. 2026-27, code m2-r3, 2026-10-01)

Target: walk-forward out-of-sample xG v2 (`xg2_asof`) for 2011-12 .. 2025-26, the 2011-12 fold's
season-start model for the 2010-11 burn-in, the live artifacts for 2026-27 (`v2_source`); 100%
of the lake's unblocked non-penalty-shot attempts covered in every season.

**Stint level** (`out/rapm_validation.json`): tuning 2021-22 + 2022-23 picks `v_new 0.02`,
`kappa 1.25` (v1 target: kappa 1.5, one grid step away).  Next-30-day weighted MSE of stint
xG/60, RAPM v2 minus baseline (z, game-clustered):

| Fold | vs team-only (a) | vs no-prior RAPM (b) | vs prior-only (c) |
|---|---|---|---|
| 2023-24 dev | -0.2044 (-16.7) | -0.0966 (-9.8) | -0.0324 (-6.8) |
| 2024-25 dev | -0.2291 (-15.6) | -0.1127 (-10.1) | -0.0399 (-7.1) |
| 2025-26 (report) | -0.1956 (-13.4) | -0.0959 (-8.7) | -0.0395 (-6.7) |

Gate PASS, and RAPM v2 beats all three baselines in all 15 seasons 2011-12 .. 2025-26.

**Game level** (`../lineup/out/lineup_eval.json`, dev folds only, no holdout look): Δ log loss
vs the live feature set (`d_lineup` included) on xG v2 inputs, per game:

| Variant | 2023-24 | 2024-25 | dev pooled (SE) |
|---|---|---|---|
| `bu_d_net` | +0.00045 | -0.00175 | -0.00057 (0.00052) |
| `bu_d_delta` | +0.00045 | -0.00163 | -0.00051 (0.00085) |
| `bu_d_net + bu_d_delta` on top of `d_lineup` | +0.00100 | -0.00289 | -0.00080 (0.00100); A2 fails (2023-24 > +0.0005) |
| `bu_d_net + bu_d_delta` **replacing** `d_lineup` | +0.00003 | -0.00285 | **-0.00130 (0.00105)** |

L-asof (previous game's 18): -0.00047 dev pooled.  The shipped configuration is "replacing"
(fixed by the v1-target review before this run, see below); its joint retrain against the live
model, 2023-24 .. 2025-26, is in `../lineup/out/joint_retrain.json` and `pipeline/bu/README.md`.

Descriptive, not used for selection: the same joint candidate with the **v1-target** feature
table scores better in the backtest (vs the live model, dev pooled -0.00214 vs -0.00147 for the
v2 target; 2025-26 -0.00317 vs -0.00180).  The v1 pickle is in sample for 2022-26 (fit on a
random 80/20 split of those seasons' shots, goals included), so a v1 target carries
information from later games of the same seasons into point-in-time ratings, and that edge
cannot carry over to live 2026-27 games.  The v2 target is strictly walk-forward and ships.

## Results (lake 2010-11 .. 2026-27, xG v1 target, code m2-r3, 2026-10-01; archived in out/xgv1/)

Era handling: 2020-21 rows at weight 0.5; the 2019-20 on-ice anomalies are handled by dropping
games whose shift charts disagree with `situationCode` on > 10% of shots (138 games; the kept
2019-20 games match on 99.7% of shots), and 2019-20 / 2020-21 get half weight in the aging fit.
Sensitivity (DESIGN §3.2.1): with 2019-21 left out entirely the tuning picks `v_new 0.03,
kappa 1.25`, within one grid step of the main pick, so the main run stands
(`out/xgv1/rapm_validation_excl_2019_2021.json`).

**Stint level (DESIGN §3.2.2, `out/xgv1/rapm_validation.json`).** Burn-in 2010-11; tuning 2021-22 +
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

**Game level, lineup term as a feature of the incumbent** (`../lineup/out/xgv1/lineup_eval.json`):
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
`../lineup/out/xgv1/lineup_eval_degraded.json`): -0.00194, a 0.0001 loss (< the 0.0005 DESIGN §4.3 threshold).

The holdout A-comp test (one-sided 98.75% upper bound < +0.0005) did **not** pass on its single
look (+0.0011: favourable point estimate, underpowered).  The look was taken with code m2-r1;
the review fixes since (aging step, sigma2 guard and era scale, season-prior fallback) cannot be
re-looked at on 2025-26 (one look per component), so their holdout value is unknown.  Pooling
dev and the logged look: -0.0022 (SE ~0.0008, n 3,999).  **Owner decision (2026-10-01): ship on
this pooled evidence, keeping the old version in shadow for rollback; the 2026-27 live games are
the clean re-test.**

**Against the live F1 model** (`../lineup/out/xgv1/lineup_eval_vs_f1_main.json`, descriptive: main's
`train_game_model` with `d_lineup`, logit-elo-v5-20261001): adding the term on top of `d_lineup`
gives dev Δ -0.00137 (SE 0.00097; 2023-24 +0.00014, 2024-25 -0.00313; A2 passes, early-season
upper bound +0.0029 fails A4), while **replacing `d_lineup` with it gives -0.00183**
(2023-24 -0.00072, 2024-25 -0.00312).  Recommendation for the joint retrain: replace `d_lineup`
with `bu_d_net + bu_d_delta`, and keep F1 in shadow.
