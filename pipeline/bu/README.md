# `pipeline/bu/`: bottom-up model

The bottom-up (BU) model is the player-impact, lineup-adjusted xG and game-state model. Its design doc is `DESIGN.md` (v2, 2026-10-01). It is built milestone by milestone (DESIGN §8); this file covers what has landed so far.

Run everything from `pipeline/`, so that the shared helpers (`http_utils`, `season`) import as top-level modules:

```bash
cd pipeline
python -m bu.lake.backfill --help
```

## Live: xG v2 + the RAPM v2 lineup term (shipped 2026-10-01)

Owner decision 2026-10-01: ship xG v2 (`bu/xg/README.md`) and the RAPM v2 lineup term
(`bu/rapm/README.md`) together on pooled evidence, keeping the replaced model as a rollback
shadow.  The live game model is `logit-elo-v5-20261001-xg2-rapm`
(`python3 retrain.py --joint --promote`, report `bu/lineup/out/joint_retrain.json`): the
incumbent logistic + Elo features on xG v2 inputs, with `bu_d_net` (tonight's dressed
skaters' EV RAPM net xG/60, home - away) and `bu_d_delta` (the same vs each team's last 10
lineups) in place of the F1 `d_lineup`.

**Backtest vs the model it replaced** (walk-forward, Δ log loss per game; the baseline
reproduces the replaced model's own cv_results exactly):

| Fold | n | Δ LL | Brier old → new | cal. slope new (95% CI) |
|---|---|---|---|---|
| 2023-24 | 1,399 | +0.00015 | 0.2339 → 0.2340 | 0.99 (0.78-1.21) |
| 2024-25 | 1,206 | -0.00334 | 0.2362 → 0.2346 | 1.09 (0.81-1.37) |
| 2025-26 | 1,394 | -0.00180 | 0.2432 → 0.2423 | 0.82 (0.58-1.06) |
| pooled | 3,999 | **-0.00158** (SE 0.00099; bootstrap 95% CI -0.00351..+0.00034) | | 0.947 (0.808-1.086) |

Early season (either team ≤ 15 GP): -0.00375 (SE 0.00241).  Against the de-vigged market
(descriptive; 410 games of one soft book, last pregame snapshot, leaky L-actual lineups):
new - market -0.00807 (SE 0.00537).  2025-26 was the soft holdout of both components; the
pre-registered live test (Gate C: `bu_shadow_home_win_pct` vs `f1_shadow_home_win_pct`,
amendment 2026-10-01 in `preregistration.yaml`) on 2026-27 is the clean one.

**Serving** (`predict_games.py` → `ml_predict.MLPredictor`):
- `bu_d_net` / `bu_d_delta` come from `bu.lineup.serve.LiveLineupTerm` over tonight's
  DailyFaceoff lines (players out / IR / suspended removed, names mapped by the bundle's
  crosswalk).  Neutral 0 (and empty `side_lineup_*`) when the bundle is older than 36 h, a
  side maps < 10 skaters or rates < 14; the reason is logged.
- Why panel: `bu_d_net` is part of the `strength_5v5` factor, `bu_d_delta` the `lineup_goalie`
  factor ("Who plays"); `side_lineup_score` = each side's `delta`, `side_lineup_matched` = its
  mapped DFO skaters.  No frontend change.
- Shadows, every pregame row (frozen with the prediction): `bu_shadow_home_win_pct` (term on),
  `f1_shadow_model_win_pct` / `f1_shadow_home_win_pct` (the replaced F1 model on its own xG v1
  inputs, published-style blend).  SiteHistory records the F1 shadow as `home_inc_model%` /
  `home_inc%`.
- xG: `game_model_meta.json` `"xg_version": "v2"` released the interlock, so an unset
  `PONYXG_XG` publishes v2 xG with `xg_raw_v1` kept as the rollback column.

(FIN added 2026-10-02: see "FIN in the game model" below.)

**Daily bundle refresh** (`.github/workflows/bu_refresh.yml`, 09:23 / 11:23 / 17:23 UTC):
`python -m bu.lineup.refresh --lake-dir $RUNNER_TEMP/lake` (gap-driven current-season ingest,
seeded season refit with the xG v2 target, bundle rebuild; ~1 min), lake saved to the
`lake-<season>` release asset, only the ~0.2 MB bundle committed.  The full pipeline records
`manifest.sources.bu_bundle` and a `stale` flag past 36 h; `validate_outputs.py bu_bundle`
fails on a missing / wrong-season / malformed bundle.

**Rollback** (repository variables read by `update_data.yml`, no code change):
- `PONYXG_BU=off`: the incumbent without the term is published, i.e. the F1 rollback model
  `models/shadow/game_model_f1.pkl` (`model_version` says which model made each row); the joint
  model's term-on probability stays in `bu_shadow_home_win_pct`.  The same automatic fallback
  applies per game when the term is unavailable (bundle older than 36 h, a side under the
  coverage gate).  The joint model is not run with zero-filled `bu_d_net` / `bu_d_delta`:
  `bu_d_net` carries part of team strength there, so zeros shrink every pick toward 50%
  (walk-forward 2023-26 vs the F1 model: +0.0013 / +0.0007 / +0.0005 log loss per game).
- `PONYXG_XG=v1`: xG v1 again (`bu/xg/README.md` "Rollback").
- Full rollback to the previous model: `git checkout <commit before 2b2622b9> --
  pipeline/game_model.pkl pipeline/game_model_meta.json` (the same pickle is
  `models/shadow/game_model_f1.pkl`), then `python -m bu.xg.history revert` if xG v1 inputs are
  wanted for training too.
- `BU_REFRESH=off` stops the refresh crons.

**Season rollover**: build the next season's pack from the full lake
(`python -m bu.lineup pack --season <S>` after `bu.rapm asof` through S-1 with the v2 target)
and commit it before the new season's first games; until then the refresh fails (no pack), the
bundle ages past 36 h and the term is served neutral.  Also build and commit the season's FIN
pack (`python -m bu.rapm.finishing pack --season <S> --xg <the asof xG source> --out <RAPM state>`
-> `bu/lineup/out/fin_pack_<S>.json.gz`); without it the bundle has no FIN table, the
refresh logs a warning, `validate_outputs.py bu_bundle` fails on the fresh bundle and the
no-FIN rollback model (`shadow.rapm`) is published.  Also build and commit the season's
player sample for the site ratings (`python -m bu.lineup.ratings_export sample --lake-dir <lake>
--season <S>`: EV minutes / games of the three seasons before S, names of every lake player).
And build and commit the season's **ratings v3 pack** (`python -m bu.rapm.v3_pack pack --season <S>
--xg <the asof xG source> --out <RAPM state>` from the full lake, after `bu.rapm asof` through S so
the season's aging curve is in `prior_pack/season=S` -> `bu/lineup/out/ratings_pack_<S>.json.gz`,
~1.7 MB); without it the bundle has no `v3` table, `validate_outputs.py bu_bundle` fails on the
fresh bundle and the site's `player_ratings.json` is not re-exported (the last file stays).

**Site player ratings: ratings v3** (`bu/lineup/ratings_export.py` -> `public/data/player_ratings.json`,
version 3; model and validation: `bu/rapm/README.md` "Ratings v3"; schema: `pipeline/CONTRACT.md`):
the one player rating the site shows (/players, team pages, the matchup Lines tab).  Headline
`impact` = goals per 82 games above an average player at his position (F / D) = `off_impact`
(EV offence + PP offence + finishing) + `def_impact` (EV defence + PK defence), each rate times his
expected minutes per game in the state; per-60 rates `ev_off`, `ev_def`, `pp_off`, `pk_def`, `fin`
and expected minutes `toi_ev_gp`, `toi_pp_gp`, `toi_pk_gp` as secondary columns; `sd` = posterior SD
of `impact`; the v2 names `off` (= `ev_off`), `def` (= `ev_def`), `net = off + def`, `off_total =
off + fin`, the EV sample (`toi`, `gp`, `toi_cur`, `gp_cur`), `roster` and `rated` stay.  Source: the
serving bundle's `v3` table (`bu.lineup serve` rolls the season's ratings pack through the season's
games: in-season weights move with every game, so the daily refresh rolls the recency forward).
Exported by every bundle refresh (`bu_refresh.yml` commits it with the bundle) and by the daily full
run (`refresh_pipeline.py` stage `player_ratings`: today's rosters), rewritten only when its content
changed; `validate_outputs.py player_ratings` gates it.  The game model is unaffected: ratings v3
in the lineup term did not beat the live model on the dev seasons (`bu/rapm/README.md`), so the
bundle's `players` / `fin` tables (`bu_d_net`, `bu_d_delta`, `bu_d_fin`) stay RAPM v2 / FIN v2.

## FIN in the game model (shipped 2026-10-02)

Owner approval 2026-10-02 ("Yes" to wiring FIN into the game model; no blend cap).  The live
model is `logit-elo-v5-20261002-xg2-rapm-fin` (`python3 retrain.py --fin --promote --no-legacy`,
report `bu/lineup/out/retrain_fin.json`): the joint model's features plus

`bu_d_fin` = sum over tonight's dressed skaters of expected EV TOI share x FIN, home minus away,
where FIN (`bu/rapm/finishing.py`, `bu/rapm/README.md` "OFF credibility pass") is the shrunk EV
goals above xG per 60 (prior 60 xG).  Training: the `bu_d_fin` column of
`lineup_features.csv.gz` (point in time: FIN from games up to d - 2 days, the same shares as
`bu_d_net`; neutral 0 under the coverage gate) - the definition the dev evaluation
(`lineup_eval_rapm_fin.json`) used.  Serving: `features.side_term(..., fin=)` on the bundle's
`fin` table reproduces the training table to 1e-5 on the 2026-27 opening games.

**Promotion rule** (fixed before the look): better than the live model on both dev seasons and
pooled, and the single 2025-26 look (M3 FIN component, `look_log.jsonl`) not worse by more than
+0.0010 log loss per game.  Walk-forward, paired per game vs `logit-elo-v5-20261001-xg2-rapm`
(its cv_results reproduced exactly):

| Fold | n | Δ LL (SE) | Brier old → new | cal. slope new (95% CI) |
|---|---|---|---|---|
| 2023-24 dev | 1,399 | -0.00067 (0.00039) | 0.23378 → 0.23346 | 0.99 (0.78-1.21) |
| 2024-25 dev | 1,206 | -0.00046 (0.00074) | 0.23469 → 0.23447 | 1.10 (0.81-1.38) |
| dev pooled | 2,605 | **-0.00057 (0.00040)** | 0.23420 → 0.23392 | 1.04 (0.87-1.21) |
| 2025-26 holdout look | 1,394 | **+0.00075 (0.00090)** (rule: <= +0.0010) | 0.24249 → 0.24284 | 0.80 (0.56-1.04) |
| 2023-26 pooled | 3,999 | -0.00011 (0.00041) | 0.23709 → 0.23703 | 0.94 (0.80-1.08) |

The 2025-26 look went the wrong way (point estimate; within one SE of zero) and the early-season
2025-26 games most (+0.0024, SE 0.0022).  Against the de-vigged market (descriptive: 410 games
Mar-Jun 2026 of one soft book, last pregame snapshot, leaky L-actual lineups): live model 0.66702,
FIN model 0.67041, market 0.67441 log loss; FIN minus live +0.0034 (SE 0.0017), FIN minus market
-0.0040 (SE 0.0052).  The standard `promotion_checks` gate fails on the 2025 fold (+0.00075 >
+0.0005, slope 0.80 < 0.9); the owner rule above is binding.  2026-27 live games are the clean
test (`bu_shadow_home_win_pct` now carries the FIN model).

**Missing FIN / rollbacks** (FIN is never zero-filled):
- the bundle has no `fin` table (older refresh code, no `fin_pack_<S>` for the season): the
  joint model without FIN (`models/shadow/game_model_rapm.pkl`, meta `shadow.rapm`, the replaced
  `logit-elo-v5-20261001-xg2-rapm`) is published with tonight's `bu_d_net` / `bu_d_delta`;
  without that file, the F1 rollback model.  A player missing from the table has FIN 0 (the
  backtest's convention for a player with no shots).
- stale bundle / coverage gate / `PONYXG_BU=off`: the F1 rollback model, as before.
- `PONYXG_BU=nofin` (repository variable): the no-FIN joint model is the live model (its own F1
  chain unchanged).  Full rollback: `git checkout <commit before the FIN retrain> --
  pipeline/game_model.pkl pipeline/game_model_meta.json` (the same pickle is
  `models/shadow/game_model_rapm.pkl`).

**Refresh**: `bu_refresh.yml` needs no change: `bu.lineup serve` adds the `fin` table from the
committed `fin_pack_<S>.json.gz` plus this season's games in the refit's xG / stints caches.

## Game simulator (M5, `bu/sim/`)

A continuous-time Monte Carlo of every game (regulation, 3v3 OT, shootout; penalties and power
plays, pulled goalies, score effects, a post-goal lull, a strength-tilt shock), with rates built
from the RAPM v2 lineup term, FIN, the expected starters and a point-in-time team state.  It
prices every market in `odds.json` (regulation 3-way, puck line, totals with pushes, 1st-period
3-way and 2-way) in `predictions_detailed.csv` (CONTRACT "Game simulator"), anchored to the
published win % and total.  Since 2026-10-03 its own win % is the model win % (before the
unchanged market blend), promoted by the pre-registered comparison `bu/sim/prereg_primary.json`
(dev 2023-25 log loss 0.6588 vs the logit's 0.6595; holdout 2025-26 0.6793 vs 0.6792, inside the
+0.0010 margin); the logit game model is a logged shadow (`logit_*`) and the per-game fallback,
and `PONYXG_WINPCT=logit` rolls back.  Derivative EVs are INFO ONLY until the live closing-line
test of `bu/sim/prereg.json` passes.  Model, fitted parameters and validation:
`bu/sim/README.md`.

## `bu.lake`: event / shift / roster lake (M0b, DESIGN §2.1-2.3, §2.6)

### Layout

The lake lives at `data/lake/`. It is gitignored (decision D4). Override the location with `--lake-dir` or `PONYXG_LAKE_DIR`.

```
data/lake/
  raw/{pbp,boxscore,rightrail,shifts,roster,schedule}/{season}/{key}.json.gz   immutable payloads, as served
  raw/_manifest.jsonl      append-only fetch log: endpoint, key, status, http, bytes, sha256, fetched_at
  raw/_manifest.parquet    compacted manifest (last record per endpoint/key)
  parquet/{table}/season={season}/part-0.parquet    zstd, one partition per season
  dq/dq_report_latest.json            DQ gate (plus timestamped copies)
  dq/throughput_latest.json           last run's throughput + remaining-backfill projection
  dq/throughput_history.jsonl         one line per fetching run
```

### Sources

All sources are free. Every season ID is passed explicitly; nothing uses `/now` or `/current`.

| Endpoint | URL | Host | Used for |
|---|---|---|---|
| `schedule` | `/stats/rest/en/game?cayenneExp=season={season}` | api.nhle.com | Game list. One call per season, refreshed every run for the current season. |
| `pbp` | `/v1/gamecenter/{id}/play-by-play` | api-web.nhle.com | Events, `situationCode`, coordinates, `rosterSpots` |
| `boxscore` | `/v1/gamecenter/{id}/boxscore` | api-web.nhle.com | Dressed lineup, starting goalie, TOI, finals |
| `rightrail` | `/v1/gamecenter/{id}/right-rail` | api-web.nhle.com | Scratches (with player IDs), officials, coaches |
| `shifts` | `/stats/rest/en/shiftcharts?cayenneExp=gameId={id}` | api.nhle.com | Shift charts. Lags finished games by up to ~48 h. |
| `roster` | `/v1/roster/{team}/{season}` | api-web.nhle.com | Crosswalk and bio data (birth date, handedness, height, weight) |

### Commands

```bash
# Full backfill, 2010-11 .. 2026-27, game types 02+03. Resumable: Ctrl-C at any time, then
# re-run the same command. The 2018-26 priority window is fetched first.
python -m bu.lake.backfill --seasons 2010-2026 --rps 2

# Plan only: requests, hours and disk per host. Makes one game-list call per season.
python -m bu.lake.backfill --seasons 2010-2026 --estimate

# Validation sample (the sm-lake acceptance run): 4 evenly spaced games per season
python -m bu.lake.backfill --seasons 2010,2015,2019,2023,2026 --sample 4

# Incremental update of the current season
python -m bu.lake.backfill --seasons 2026

# Rebuild parquet and re-run the gate without fetching
python -m bu.lake.backfill --seasons 2010-2026 --build-only

# DQ gate on its own
python -m bu.lake.dq                 # coverage vs every final game of each built season
python -m bu.lake.dq --built-only    # coverage vs the games present (samples)
python -m bu.lake.dq --strict --no-allowance
```

Options:
- `--rps`: request starts per second **per host**. The default is 2, the ceiling the owner approved (D5). Higher values are clamped to 2.
- `--workers-per-host`: default 2. It hides latency without exceeding `--rps`.
- `--endpoints`: default `pbp,boxscore,rightrail,shifts,roster`.
- `--retry-failed`: also re-tries 404s from closed seasons.
- `--max-requests N`: stops after N HTTP requests.
- `--jobs`: number of parse processes.

### Throughput and the full-backfill estimate (measured 2026-10-01)

**Sample run:** `--seasons 2010,2015,2019,2023,2026 --sample 4`, 20 games plus their team rosters.

| Host | Requests | Rate | Mean latency | Mean size |
|---|---|---|---|---|
| api-web.nhle.com | 95 | 2.00 rps | 0.27 s | 4.0 KB gz |
| api.nhle.com | 25 | 2.00 rps | 0.14 s | 17.9 KB gz (shifts) |

Two workers per host are enough to reach the cap.

**Full plan** (`--seasons 2010-2026 --estimate`): 20,577 final games of types 02 and 03.

| Host | Requests | Time at 2 rps |
|---|---|---|
| api-web.nhle.com (pbp, boxscore, right-rail, rosters) | 62,203 | **8.6 h** (critical path) |
| api.nhle.com (shifts) | 20,577 | 2.9 h, in parallel |

The raw archive is about 0.8 GB gzipped and the parquet about 0.3 GB.

The 2018-26 priority window is about 4.4 h, so it fits in one night. Two ways to shorten the run:
- Skip `rightrail` with `--endpoints pbp,boxscore,shifts,roster`. This saves about 2.9 h of the api-web critical path but loses the scratches. They can be fetched later with `--endpoints rightrail`, because the backfill resumes.
- Run 2018-2026 first, then 2010-2017.

### Tables

**`games`**
- Teams, finals, `last_period_type`, venue and start time.
- Coverage flags: `has_shifts`, `has_boxscore`, `has_rightrail`.
- Per-game QA counts: raw/duplicate/merged shift rows, non-shootout PBP goals by side, and `side_source`.

**`events`** (every play)
- Clock: period seconds and game seconds.
- `situationCode` split into `sit_{home,away}_{sk,g}`.
- Strength and goalie state from the acting team's view: `strength` (e.g. `5v4`), `empty_net_against`, `own_goalie_pulled`, `is_penalty_shot`.
- Running score before the event.
- Every player-ID field.
- Coordinates:
  - raw `x`, `y`;
  - `x_norm`/`y_norm`, with the acting team attacking +x;
  - `x_home`/`y_home`;
  - for shots, `shot_distance` and `shot_angle` to the attacked net at (89, 0).
- Side: `home_def_side` with its `side_source` (`raw`, or `inferred` where `homeTeamDefendingSide` is missing). The vote is in `home_def_side_vote`.
- On ice: `home_skaters`/`away_skaters` (lists of IDs), `home_goalie_id`/`away_goalie_id`, counts, and `onice_rule`:
  - `primary`: the boundary rule matched;
  - `alt`: the opposite boundary rule matched exactly;
  - `mismatch`: neither matched; kept and visible;
  - `nosit`: the event has no `situationCode`;
  - `none`: no shifts.
- Shooting team comes from the shooter's roster team, because blocked-shot ownership has varied over the years.

**`shots`**
- Shot attempts (codes 505-508) outside the shootout, with shot-oriented columns plus `is_goal` and `is_unblocked`.

**`shifts`**
- Only `typeCode` 517 rows; the feed also carries goal rows.
- De-duplicated on (player, period, start, end). 2023020500 has 295 duplicates.
- A player's overlapping copies of a shift are merged (for example 310-313, 310-342 and 331-342), so no one is counted on the ice twice.

**`lineups`**
- Dressed players (boxscore ∪ `rosterSpots`) and scratches (right-rail).
- Starter flag, boxscore TOI, shift count and shift TOI.

**`players`** (the crosswalk)
- One row per player and season.
- NHL ID, names, `name_key` (accent- and punctuation-free) and `name_key_alias` (nickname-normalised first name).
- Teams, sweater numbers, games dressed and scratched, and bio data from the team roster.
- `crosswalk.resolve(players, name, team=, number=)` maps a display name to an NHL ID. The M2 crosswalk adds DailyFaceoff IDs on top of this.

#### On-ice boundary rule

Shift times are whole seconds. For an event at time t:
- Faceoffs and period starts take the shifts that **start** at t: `start <= t < end`.
- All other events take the shifts that **end** at t: `start < t <= end`.

If the per-team skater and goalie counts disagree with `situationCode`, the opposite rule is used only when it matches exactly. The DQ report shows how often the primary rule alone matched.

#### Side inference

`homeTeamDefendingSide` is missing for 2010-11 to 2016-17 and for some later games, for example 2018020500. For each (game, period), every event with coordinates and an O or D zone votes. `zoneCode` is always given from the event owner's point of view. Where the raw field exists it wins, and the DQ gate reports its agreement with the vote: 100% (39 of 39 periods) on the sample.

### DQ gate (`bu.lake.dq`, DESIGN §2.6)

The thresholds and their provenance are in the `bu/lake/dq.py` docstring.

**Sampling allowance**
- Rate checks pass when value + 3·SE ≥ threshold. SE is clustered by game, because feed errors come in runs.
- `strict_pass` records the result without the allowance.
- On a full season SE is tiny, so the gate converges to the strict thresholds.
- `--no-allowance` makes the strict thresholds binding.
- Exact checks (coverage, goals vs final, duplicates) never get an allowance.

**Sample result (21 games, 6 seasons):** PASS, 99 of 99 checks.
- Coverage, goals vs final, duplicates, shift coverage, coordinates, one-goalie/EN, zone-side consistency and crosswalk: all 1.0 or 0.
- `onice_vs_situation`: 0.9942 pooled, with the primary rule alone matching 0.9926. The misses come from:
  - 2019020758, where the feed codes two minors to one player (a 5v4 for about 4 minutes) as `1531`, i.e. 5v3, while the shift charts show 4 skaters. The lake keeps the event and flags it `mismatch`;
  - two penalty shots, which are excluded from the denominator.
- Inferred-side seasons are within 1 ft of the 2021+ mean shot distance (0.62, 0.45 and 0.996 ft).

**Deviation from DESIGN §2.6, documented:** the literal "≥ 99% of shots < 89 ft from the attacked net" check misses even where the side field is present: 97.2-98.7% in 3-4-game-per-season samples. Long shots on goal from the defensive or neutral zone are real, and their zone codes confirm it. A literal 99% would fail every full raw-side season, so:
- `side_attacking_range` gates inferred-side seasons **relative** to the raw-side 2021+ reference share: the shortfall must be ≤ 1 pp. A flipped period puts about half its shots beyond 89 ft, so this catches flips in about 2% of periods.
- Raw-side rows are reported but not gated.
- The 2021+ reference, for this check and for `side_mean_distance`, is read from the lake's own partitions when the run has none. The 2010-2017 leg of the backfill is therefore still gated.
- If the lake has no 2021+ season at all, `side_attacking_range_abs` applies an absolute floor of 97%.
- `side_zone_consistency` remains the direct per-shot correctness test.

**Feed defect handled:** the shift chart for 2025020565 (NJD-BUF) also carries about 670 VGK/SJS shifts. The lake drops rows of any team other than the game's two and counts them in `games.n_shift_foreign_team`; the DQ `shift_duplicates` detail reports the total. `fetch_shifts.py` does the same using the boxscore, and the tracked 2025-26 file was repaired.

### Not yet in the lake

These are follow-ups for later milestones:
- `stints` for RAPM v2 (M2).
- DailyFaceoff IDs in the crosswalk (M2).
- The ESPN pickcenter audit and `odds_hist`/`snapshots` tables (sm-snapshots / M0b).
- The xG v1 vs MoneyPuck §2.6 check (M1).
- Release-asset sync: `data-lake-v1` and `lake-2026-27`.

## Repo fixes in this milestone (DESIGN §3.0)

**`update_raw_pbp.py`**
- Cause of the duplicates: `/schedule/{date}` returns the whole game week, so each look-back day queued the same games again. `raw_pbp_<season>.csv` ended up with every play 2-3 times.
- Now the schedule is filtered to the requested day, the write is an upsert on (game_id, eventId), and a file that already has duplicates is healed once.
- The "2x" in the season `pbp` CSV is by design: one row per team perspective, keyed on `is_home_team`.

**`fetch_shifts.py`**
- REST first, with player IDs. A REST gap is retried for 72 h before the HTML fallback is used.
- The HTML fallback now takes player IDs and home/away from the boxscore.
- Each run re-tries REST for up to 60 stored games that lack IDs.
- The 493 HTML-sourced 2025-26 games were re-fetched: the null `player_id` share went from 0.349 to 0.000.
- REST rows of teams other than the game's two are dropped. The boxscore is fetched only when a payload has more than two teams.
- A stored file that still has duplicate shift rows (from before de-duplication) is healed on the next run, even when no games are new.
