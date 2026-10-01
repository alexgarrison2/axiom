# Predictions data contract (schema v2)

`predictions_detailed.csv` is written by `pipeline/predict_games.py` to
`data/predictions_detailed.csv` (server copy) and
`public/data/predictions_detailed.csv` (browser copy). The two files are
identical. `pipeline/validate_outputs.py` checks the contract before the
workflow commits (`predictions`, `placeholders`, `after_start`).

Fixtures for building and testing the frontend without a live refresh:

| File | What it covers |
|---|---|
| `pipeline/fixtures/predictions_opening_night.csv` | Opening night (2026-09-29): every team at 0 GP, CAR (last season's Cup finalist) with no leaked playoff games, one FINAL game with a frozen pregame prediction, one LIVE game with `no_pregame_prediction`, a -110/-120 pick'em, TOR on a back-to-back the next day |
| `pipeline/fixtures/predictions_week3.csv` | 2026-10-20: 7-9 GP per team, TBL at 3 GP (`L3`), a pair that met once and a pair that met twice, home/road records with 5+ games, a 6-game road trip, ranks still gated |
| `pipeline/fixtures/predictions_playoffs.csv` | A first-round playoff game (`game_type` 03): career playoff goalie line and `PO G<n>` numbering. Only each team's last 10 regular-season games are simulated, so `side_gp` reads 10 rather than a full season |

Regenerate them with `cd pipeline && python3 fixtures/make_fixtures.py`.
They are produced by the same row builder as the live file.

## General rules

* **Empty means "no data".** No column uses a neutral placeholder: there is
  no rank 16, no `0-0-0` record, no GAS 65 and no `N/A` odds. A cell is empty
  when there is nothing to show yet: a team at 0 GP, a sample below its gate,
  no odds, or no pregame prediction.
* **Season scope.** Every context value belongs to `season_id` (the current
  season, `pipeline/season.py`). Previous-season values appear only in
  `*_prev` columns, and `context_season` is set to the previous season id
  whenever a row contains one.
* **Units.** Win probabilities are percentages from 0 to 100 with 1 decimal.
  EV is a **fraction** of the stake (`0.051` = +5.1%). Rates such as PP% are
  fractions from 0 to 1. Timestamps are ISO-8601 UTC (`2026-09-30T23:30:00Z`).
* **Booleans** are written as `True` / `False`.
* **JSON cells** hold JSON text (lists or objects) inside a quoted CSV field.
* **Puck drop.** A game is never predicted after it starts. See
  `prediction_status`. The model outputs of a pregame prediction (the
  columns marked *frozen*) are copied byte for byte after puck drop. Every
  other column is recomputed on each run.
* `side_` below stands for both `home_` and `away_`. For example
  `side_gp` means `home_gp` and `away_gp`.

## Columns

Column order in the file is the order of `predict_games.COLUMNS`.

### Identity and status

| Column | Type | Null | Description |
|---|---|---|---|
| `schema_version` | int | no | Always `2`. |
| `season_id` | string | no | NHL season id, e.g. `20262027`. |
| `game_type` | string | no | `02` regular season, `03` playoffs (digits 5-6 of the NHL game id). |
| `nhl_game_id` | string | no | 10-digit NHL game id, e.g. `2026020008`. Preferred join key. |
| `game_id` | string | no | Legacy key `YYYY-MM-DD-<Away>-<Home>` (common names). Used by SiteHistory. |
| `game_date` | date | no | NHL local game date (`YYYY-MM-DD`, Eastern). |
| `start_time_utc` | ISO-8601 UTC | no | Scheduled puck drop, identical to the NHL schedule `startTimeUTC`. |
| `game_start_time` | string | yes | Deprecated display clock in US Central (`06:30 PM`). Derive local time from `start_time_utc` instead. |
| `game_state` | string | no | NHL `gameState` when the row was written: `FUT`, `PRE`, `LIVE`, `CRIT`, `FINAL`, `OFF`. |
| `prediction_status` | enum | no | `pregame`: predicted before puck drop and still pregame. `frozen`: a pregame prediction, frozen at puck drop. `no_pregame_prediction`: the game started before any prediction of this season existed, so all model columns are empty. `no_model`: the game model was unavailable. |
| `context_season` | string | yes | The previous season id (e.g. `20252026`) when any `*_prev` column in the row is filled, else empty. |
| `home_team` | string | no | Home team common name (`Maple Leafs`). |
| `away_team` | string | no | Away team common name. |
| `home_abbrev` | string | no | Home tricode (`TOR`). |
| `away_abbrev` | string | no | Away tricode. |

### Model and market (frozen after puck drop)

All of these columns are empty unless `prediction_status` is `pregame` or `frozen`.

| Column | Type | Null | Description |
|---|---|---|---|
| `predicted_at` | ISO-8601 UTC | no | When the model outputs were computed. It only changes when an output changes. |
| `model_version` | string | no | Game model version (`logit-elo-v5-...`). |
| `preseason_prior` | bool | no | `True` while either team has fewer than 10 regular-season GP (the model is running mostly on priors). |
| `side_model_win_pct` | float % | no | Model-only win probability, before the market blend. |
| `side_win_pct` | float % | no | **Published** win probability: the model blended with the de-vigged market (`market.py`). Home + away = 100. |
| `side_model_odds` | string | no | Fair American odds of the **model-only** probability `side_model_win_pct` (`-125`, `+105`). Before fix1-G1 this held the published line; rows frozen before then are relabelled on read. |
| `side_blend_odds` | string | no | Fair American odds of the **published** probability `side_win_pct` (the blend). Both lines are computed from the rounded percentages and agree with them to within 1 cent (validate_outputs `fair_odds`). |
| `side_vegas_odds` | int | yes | Market moneyline (American) at prediction time. Empty without a line. |
| `side_vegas_win_pct` | float % | yes | De-vigged market probability (power method). Home + away = 100.0 ± 0.1. |
| `blend_weight` | float | yes | Model weight in the logit blend (0-1). It ramps up from 0.2 over the first 20 GP. Empty without odds. |
| `side_ev` | float fraction | yes | Expected profit per unit staked at `side_vegas_odds`, using the published (blended) probability. `-0.0457` = -4.57%. |
| `ev_gated` | bool | no | `True` only when `market.gate` allows a bet on this game. The gate requires a backtest-proven edge, a rolling log loss that beats the market, EV ≥ 3%, and both teams at 10+ GP. |
| `bet_side` | enum | yes | `home` / `away` when units are shown, else empty. |
| `units` | float | yes | Quarter-Kelly stake in units (1u = 1% of bankroll, max 5). **Empty unless the gate is open.** |
| `wager_recommendation` | string | yes | Legacy text: `Home 1.2 Units` / `No Bet`. Empty for `no_pregame_prediction` and `no_model` rows. |
| `gate_reason` | string | yes | First reason the gate is closed, for the "no bets" note. |
| `market_source` | string | yes | Odds source (`bovada`, `draftkings`, ...). |
| `market_fetched_at` | ISO-8601 UTC | yes | When that line was fetched. |
| `side_xg` | float goals | no | Expected goals, including the expected OT goal. Backed out of the published win % (`goal_model.display_xg`), so the xG favourite is always the win % favourite. |
| `expected_total` | float goals | no | Expected total goals (league pace × matchup pace). |
| `side_xg_explained` | JSON list[string] | no | `["Even matchup: 3.08", "Home ice: +0.02", ...]`. The parts add up to `side_xg` (±0.02). |
| `home_wp_breakdown` | JSON list | no | "Why this pick": `[{factor, label, wp_delta_pts, xg_home_delta, xg_away_delta}]` in order. Factors: `home_ice`, `strength_5v5`, `special_teams`, `goaltending`, `rest`, then `lineup_goalie` for a game model with a lineup feature (who dresses and who starts in net vs the team's usual: the RAPM v2 `bu_d_delta`, or the fast-track `d_lineup` / `d_goalie_swap`; DESIGN §8 F1/M2) or `lineup` for an older model (the separate `lineup_adjust` term), then `market` when there are odds. With the RAPM v2 lineup term, `strength_5v5` also carries `bu_d_net` (tonight's dressed skaters' even-strength RAPM net xG/60, home minus away). A frozen row keeps the factor list of the model that made it. `50 + Σ wp_delta_pts = home_win_pct` (±0.1). Positive values favour the home team. |
| `pick_summary` | string | no | One sentence (≤160 chars) naming the favourite and the top 2 factors. |
| `confidence_grade` | enum | no | `A` (favourite ≥ 65%), `B` (60-65%), `C` (< 60%). Capped at `B` while `preseason_prior`. |
| `confidence_note` | string | yes | How that tier has done in live picks (`model_report.json`), plus the early-season note. |
| `side_model_goalie` | string | yes | Goalie the model used (the projected starter at prediction time). |
| `side_lineup_score` | float | yes | Tonight's lineup quality minus the team's own baseline lineup, in on-ice net xG/60. RAPM v2 models (`bu.lineup.serve.LiveLineupTerm`, `game_model_meta.json` `bu_lineup`): tonight's DailyFaceoff skaters minus players marked out / IR / suspended, mapped to NHL ids (`bu/lineup/crosswalk.py`), rated by point-in-time RAPM v2 EV offence/defence (xG v2 target) weighted by expected EV TOI share; baseline = the same ratings over the team's last 10 dressed lineups (`bu_d_delta` per side). When the serving bundle is older than 36 h, a side maps fewer than 10 skaters or rates fewer than 14, or `PONYXG_BU=off`, the row is published by the F1 rollback model (`model_version` = `shadow.f1.model_version`) and these columns carry its fast-track values below. Fast-track models (`lineup_adjust.LineupState`): MoneyPuck 5v5 on-ice relative xG/60 from the two previous seasons, weighted by expected TOI; tonight = DailyFaceoff projected lines minus players out, or the team's last dressed lineup when fewer than 14 of 18 map to NHL ids; baseline = the 18 most-used skaters over the last 20 games. Older models: RAPM net xG/60 × ice-time share. **Both sides are empty when either side has no baseline / fails the coverage gate**; the lineup term is then neutral for both. |
| `side_lineup_matched` | int | yes | Skaters in tonight's projected lineup mapped to an NHL id (fast-track models) or rated (older models), of 18. |
| `bu_shadow_home_win_pct` | float % | yes | Shadow, not displayed (DESIGN §6.2; preregistration amendment 2026-10-01). Published-style blend (same market price and `blend_weight` as `home_win_pct`) of the joint model with the RAPM v2 lineup term ON (tonight's `bu_d_net` / `bu_d_delta`; neutral 0 when the term is unavailable for the game): equal to `home_win_pct` when the joint model published the row, the term-on blend when the F1 rollback model did (`PONYXG_BU=off`, stale bundle, coverage gate). Empty for a model without the term. |
| `f1_shadow_model_win_pct` | float % | yes | Rollback shadow, not displayed: the replaced live model (`game_model_meta.json` `shadow.f1`, `models/shadow/game_model_f1.pkl`: F1 `d_lineup` on xG v1 inputs), model-only home win %. Logged every run so a rollback and Gate C have its record. |
| `f1_shadow_home_win_pct` | float % | yes | The same, blended like `home_win_pct` (Gate C/E's `blend_current` once BU is live). Equal to `home_win_pct` when the F1 rollback model published the row. |
| `total_line` | string | yes | Over/under line (`6.0`) at prediction time. |
| `total_over` | int | yes | Over price (American). |
| `total_under` | int | yes | Under price (American). |
| `side_puckline` | int | yes | Puck-line price. |
| `side_puckline_spread` | string | yes | Puck-line spread (`-1.5`). |
| `side_1p_ml` | int | yes | First-period moneyline. |
| `side_three_way` | int | yes | Regulation three-way price. |
| `three_way_tie` | int | yes | Regulation tie price. |

### Season context (recomputed every run)

| Column | Type | Null | Description |
|---|---|---|---|
| `side_gp` | int | no | Regular-season games completed this season **before this game** (club schedule; standings as a fallback). |
| `side_l7` | string `W-L-OTL` | yes | Record over the last `side_l7_n` games. Empty at 0 GP. Regular-season games only for a `02` game; regular season and playoffs for a `03` game (a playoff OT loss is an `L`). |
| `side_l7_n` | int | no | Games in the window (0-7). |
| `side_l7_label` | string | yes | `L7` from 7 GP, `L<n>` before that (`L3`). Empty at 0 GP. |
| `side_l7_games` | JSON list | no | Newest first: `{date: "10/18", gameDate, gameId, gameType, gameNumber, opponent, isHome, score, result, starter}`. `gameNumber` counts up from the season's first game (`G12`), with a separate playoff counter (`PO G3`). `result` is `W`, `W-OT`, `W-SO`, `L`, `O` (OT/SO loss, regular season) or `L-OT` (playoff OT loss). `[]` at 0 GP. |
| `side_h2h_record` | string `W-L-OTL` | yes | This season's regular-season meetings before tonight, from this side's view. Empty until the teams have met. |
| `h2h_gp` | int | no | Number of those meetings. |
| `side_h2h_prev` | string `W-L-OTL` | yes | Previous season's regular-season meetings (`nhl_historical_gamestats.csv`). |
| `h2h_prev_gp` | int | yes | Number of previous-season meetings. |
| `side_loc_record` | string `W-L-OTL` | yes | Home team: record at home. Away team: record on the road. Regular season, this season. **Empty below 5 location games.** |
| `side_loc_gp` | int | no | Location games behind that record. |
| `side_pp_rank` | int 1-32 | yes | PP rank on the regressed rate `(PPG + 30 × league PP%) / (PP opps + 30)`. **Empty until every team has ≥ 10 GP.** A permutation of 1-32 when filled. |
| `side_pk_rank` | int 1-32 | yes | PK rank, same rules. |
| `side_pp_pct` | float fraction | yes | Actual season PP% (`0.271`), for the tooltip `#3 PP · 27.1% · 14 GP`. Empty without opportunities. |
| `side_pk_pct` | float fraction | yes | Actual season PK%. |
| `side_pp_opps` | int | yes | Power-play opportunities this season. |
| `side_pk_opps` | int | yes | Times shorthanded this season. |
| `side_pp_rank_prev` | int 1-32 | yes | Previous season's final PP rank. Filled only while `side_pp_rank` is empty. These match the gamecenter right-rail `ppPctgRank`. |
| `side_pk_rank_prev` | int 1-32 | yes | Previous season's final PK rank, same rule. |
| `side_rest_days` | int | no | Days off since the previous game (0 = back-to-back), from the full club schedule, including games not yet scraped. A season opener counts from the last preseason game. Empty only in the degraded case where the NHL club schedule could not be fetched and no cached copy exists (then `side_is_b2b` is `False`). |
| `side_is_b2b` | bool | no | Played the previous day. |
| `side_games_in_last_4` | int | no | Games (including tonight) in the 4 days ending tonight. `≥3` means 3-in-4. |
| `side_games_in_last_6` | int | no | Same over 6 days. |
| `side_games_in_last_9` | int | no | Same over 9 days. |
| `side_road_trip_game_n` | int | no | Consecutive road games ending with tonight (0 for the home team). |

### Goalies, news and lineups (recomputed every run)

| Column | Type | Null | Description |
|---|---|---|---|
| `side_starter` | string | yes | Legacy display `Name (Status)`. |
| `side_goalie_confirmed` | string | yes | Projected starter (DailyFaceoff, then ESPN probable, then the first roster goalie). |
| `side_goalie_status` | enum | no | `Confirmed`, `Likely`, `Unconfirmed` or `Probable (ESPN)`. News only upgrades to `Confirmed` when a "Goalie Start" item is dated on the game date or names the opponent (whole word: nickname, full name, city or tricode), and never from an item published before the team's previous game started or naming a different weekday (so a home-and-home blurb does not confirm the rematch). |
| `side_goalie_status_source` | enum | yes | `DFO`, `ESPN probable` or `news`. Never empty for `Confirmed`. |
| `side_goalie_status_at` | ISO-8601 UTC | yes | Time of that source item (DFO news time, the news timestamp, or when the pipeline first saw the status). Never empty for `Confirmed`. |
| `side_goalie_stats` | string | yes | Deprecated alias of `side_goalie_stats_cur`. |
| `side_goalie_stats_cur` | string | yes | This season: `(W-L-OTL) \| .SV% \| GAA`. Empty before the goalie's season debut. |
| `side_goalie_stats_prev` | string | yes | Previous season's line, same format (label it `25-26`). |
| `side_goalie_cur_gp` | int | yes | This season's GP for the goalie (0 before his debut). |
| `side_goalie_po` | string | yes | Career playoff line `W-L \| .SV% \| GAA`. **Only for `game_type` 03.** |
| `side_gsax` | float goals | yes | Regressed GSAx per game (`goalie_ratings.json`). |
| `side_gsax_total` | float goals | yes | This season's GSAx total. |
| `side_gsax_pct` | float 0-100 | yes | League percentile of `side_gsax`. |
| `side_starter_vs_opp` | JSON object | yes | Career line against tonight's opponent, over the current and previous 10 seasons (regular season and playoffs): `{vs_opp_gp, record, sv, gaa, gp, toi_min, win_pct, opponent, seasons, label: "Career vs NYI (21 GP)"}`. GAA comes from time on ice. **Empty below 3 GP.** |
| `side_starter_vs_opp_gp` | int | yes | Career GP against the opponent (also set when the line is hidden). |
| `side_news` | JSON list | no | DailyFaceoff news for the team: `[{player, news, category, date, timestamp}]`. |
| `side_lineup` | JSON object | no | DailyFaceoff lines: `{f1..f4, d1..d3, g, ir, pk1, pk2, lineup_source, updated_at, fetched_at}`. |

### Removed in v2

`side_gas`, `side_gas_breakdown` (GAS was never validated; use the rest and
schedule columns), `side_xg_sparkline`, `side_avg_speed`, `side_rr_rate`,
`side_lineup_vs_team`, `side_is_3in4`, `side_is_4in6`, `side_is_6in9` (use
`side_games_in_last_N`). `side_ev` changed from a percentage to a fraction.

## Other files this contract covers

* `data/last_updated.json`, `public/data/last_updated.json`:
  `{"last_refresh": "2026-09-30T05:40:01Z"}` (ISO-8601 UTC).
* `public/data/goalie_season_lines.json` (from `fetch_nhl_goalie_stats.py`):
  `{season_id, prev_season_id, generated_at, goalies: {"Full Name": {cur: {w,l,ot,svpct,gaa,gp} | null, prev: {...} | null}}}`.
  `pipeline/nhl_goalie_stats.json` keeps the legacy flat map
  (`name -> "(W-L-O) | .SV% | GAA"`), now for the **current** season only.
* `public/data/season_projections.json` (`season_simulator.py`):
  `{season_id, generated_at, games_played, total_simulations, model, teams: [...]}`.
  `public/data/season_projections_history.json` holds one snapshot per day:
  `{season_id, snapshots: [{date, generated_at, games_played, teams: {TRI: {make_playoffs_pct, avg_points, won_cup_pct}}}]}`.
* `public/data/game_implications.json`:
  `{season_id, generated_at, baseline_generated_at, max_swing_pts, min_swing_pts, games: [...]}`.
  `games` is empty while the largest swing on the slate is under
  `min_swing_pts` (3 points).
* `public/data/player_ratings.json` (`bu/lineup/ratings_export.py`, the site's RAPM v2
  player ratings, EV xG/60 vs an average skater): `{version: 2, season, as_of, units, columns,
  rows}` with columns `id, name, team, pos, roster, rated, off, def, net, toi, gp, toi_cur,
  gp_cur`. Every rating is higher = better: `off` = xGF/60 added, `def` = xGA/60
  **prevented** (the negated RAPM `d`; version 1 carried `d` itself, lower = better) and
  `net = off + def`. Model internals (`bu.rapm`, the serving bundle, `bu_d_net`) keep `d`.
  `validate_outputs.py player_ratings` gates it.
* `public/data/clinch_status.json`:
  `{season_id, generated_at, teams: {TRI: "x" | "y" | "z" | "p" | "e" | null}}`.
* SiteHistory snapshots (`public/data/SiteHistory/<date>.csv`) gain
  `timestamp_utc` (ISO-8601 UTC), `model_version`, `home_model%` and
  `home_market%`. `timestamp` stays as the legacy US Central `HH:MM`. `*_EV`
  stays a percentage there (the snapshot converts from the fraction).
* Season shot file (`pipeline/nhl_season_<yyyy>_<yyyy>_shots.csv`, from
  `refresh_pipeline.stage_rescore_xg`): `xg_raw` is the raw output of the
  **active** shot model (no shooting talent, no league normalisation), and
  `xG` / `xG_flurry_adj` are `xg_raw` x shooting talent x league
  normalisation. The active model is chosen by `PONYXG_XG`
  (`pipeline/bu/xg/live.py`): `v1` (`xg_model_xgb.pkl`; empty-net shots get
  the constant 0.52), `shadow` (`xg_raw` from v1, plus the additive column
  `xg_raw_v2` from xG v2, `pipeline/models/xg2_*.json`) or `v2` (the
  default: `xg_raw` from xG v2, v1 only for shots v2 cannot score yet, plus
  `xg_raw_v2` and the rollback shadow `xg_raw_v1`, v1's score of every
  shot). An unset flag runs `shadow` until `game_model_meta.json` declares
  `"xg_version": "v2"`, so the published xG and the game model switch
  together; an explicit flag always wins. `xg_raw_v2` / `xg_raw_v1` are NaN
  until scored. `manifest.json` `sources.xg_model` records `mode`, `hash`,
  `v2_signature`, `v1_fallback_games`, `v2_unmatched_events` and
  `v1_shadow_hash`.
* SiteHistory also gains `home_inc_model%` / `home_inc%` (the F1 rollback shadow,
  `f1_shadow_model_win_pct` / `f1_shadow_home_win_pct`).
* RAPM v2 lineup term (`pipeline/bu/lineup/out/serving_bundle.json.gz`, rebuilt by the daily
  `bu_refresh.yml` workflow, see `pipeline/bu/README.md`): `built_at`, `max_source_date`,
  `n_games`, current ratings, TOI-share state, team lineup histories and the DFO-name
  crosswalk. `validate_outputs.py` (`bu_bundle`) fails when the live model uses the term and
  the bundle is missing or malformed, freshly built for another season or built before
  `max_source_date`; a bundle older than 36 h is not an error (the F1 rollback model is then published, see `side_lineup_score`). `manifest.json`
  `sources.bu_bundle` mirrors `built_at` / `max_source_date` / `n_games`. Rollback switch:
  `PONYXG_BU=off` (repo variable) publishes the F1 rollback model (the incumbent without the
  term) without a retrain; the joint model stays logged in `bu_shadow_home_win_pct`.
* Historical shot files (`nhl_historical_shots.csv`, last season's
  `nhl_season_<yyyy>_<yyyy>_shots.csv`) may carry `xg_raw` (raw xG v2,
  walk-forward out of sample) after `python -m bu.xg.history apply`; readers
  (`features`, `shooting_talent`, `retrain`) use it when present and re-score
  with the v1 pickle otherwise. `revert` removes it byte-exactly.
