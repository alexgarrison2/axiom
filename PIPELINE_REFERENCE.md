# NHL Predictions Pipeline — Full Reference

> **Note (2026-09-29):** this reference was written for the 2025-26 pipeline. Season file names now come from `pipeline/season.py` (`nhl_season_<yyyy>_<yyyy>_*.csv`), one-off scripts moved to `pipeline/tools/`, and `fetch_dfo_tweets.py`, `recalc_xg.py`, `feature_engine.py` and the local cron scripts were removed. See `README.md` and `CLAUDE.md` for the current layout.

> **Purpose:** Complete reference for what data is fetched, computed, and written on every pipeline run. Use this to diagnose stale data, understand prediction inputs, and audit the update schedule.

---

## Table of Contents

1. [Run Schedule Overview](#1-run-schedule-overview)
2. [Full Refresh vs. Lite Update — Side by Side](#2-full-refresh-vs-lite-update--side-by-side)
3. [Script-by-Script Breakdown](#3-script-by-script-breakdown)
4. [What Goes Into the Final xG Prediction](#4-what-goes-into-the-final-xg-prediction)
5. [Every Output File — What It Is, Who Writes It, How Often](#5-every-output-file--what-it-is-who-writes-it-how-often)
6. [Data Source Inventory](#6-data-source-inventory)
7. [Staleness Risk Register](#7-staleness-risk-register)

---

## 1. Run Schedule Overview

The pipeline runs automatically via GitHub Actions (`.github/workflows/update_data.yml`).

### When Does It Run?

Runs are triggered hourly. The **day of week** determines how many runs per day:

| Day | Type | Approx. Runs/Day |
|-----|------|-----------------|
| Tuesday, Thursday, Saturday | **Peak** — more coverage for common game nights | ~14 runs |
| Sunday, Monday, Wednesday, Friday | **Off-Peak** — hourly from morning to night | ~15 runs |

> **Note:** The schedule was written assuming CST (UTC-6). **DST (CDT, UTC-5) has been in effect since March 8.** This shifts all wall-clock times 1 hour later than comments suggest.

### The Full Refresh Window

Each run checks the current UTC hour:

```bash
HOUR=$(date +%H)
if [ "$HOUR" -ge 12 ] && [ "$HOUR" -le 14 ]; then
  # FULL REFRESH
else
  # LITE UPDATE
fi
```

| Season | Full Refresh Window (UTC 12–14) | Local Wall Clock |
|--------|---------------------------------|-----------------|
| Winter (CST, UTC-6) | 12–14 UTC | **6:00–8:59 AM CST** |
| Summer (CDT, UTC-5) | 12–14 UTC | **7:00–9:59 AM CDT** ← current |

**This means the morning runs (~3 per day) are Full Refreshes. All other runs are Lite Updates.**

---

## 2. Full Refresh vs. Lite Update — Side by Side

| Step | Full Refresh | Lite Update |
|------|-------------|-------------|
| `refresh_pipeline.py` | ✅ Runs | ❌ Skipped |
| `fetch_upcoming.py` | ✅ (called inside refresh) | ✅ Runs |
| `backfill_player_stats.py` | ✅ (called inside refresh) | ✅ Runs |
| `fetch_odds.py` | ✅ (called inside refresh) | ✅ Runs |
| `predict_games.py` | ✅ (called inside refresh) | ✅ Runs |
| `snapshot_predictions.py` | ✅ Runs (after refresh) | ✅ Runs |
| `season_simulator.py` | ✅ Runs (after refresh) | ✅ Runs |
| **Shots re-scored with xG model** | ✅ Yes — all 2025-26 shots | ❌ No |
| **Team ratings recalculated** | ✅ Yes — fresh xG values | ❌ No — uses cached `team_ratings.json` |
| **Player impact recalculated** | ✅ Yes — fresh MoneyPuck data | ❌ No — uses cached `player_impact.json` |
| **H-Ref special teams synced** | ✅ Yes | ❌ No |
| **Historical predictions updated** | ✅ Yes (generate_history.py) | ❌ No |
| **Typical run time** | ~5 minutes | ~1.5 minutes |

**Bottom line:** The Lite Update refreshes odds, lineups, and re-predicts games — but using the *same team strength ratings* from the morning Full Refresh. The model's fundamental view of team quality only updates ~3× per day.

---

## 3. Script-by-Script Breakdown

### `refresh_pipeline.py` — The Full Refresh Orchestrator

> Runs: **3× per day** (UTC 12, 13, 14) — ~5 min total

This is the heavyweight script. It does *not* just call the other scripts — it contains significant logic of its own.

**What it does, in order:**

#### Step 1 — Scrape New Game Data
Calls `nhl_scraper_poc.py` internals to fetch any games played since the last run from the NHL API.
- Fetches play-by-play JSON for each new `game_id`
- Extracts individual shot records (coordinates, shot type, player, strength state)
- Appends new rows to `nhl_season_2025_2026_shots.csv`
- Appends new game-level rows to `nhl_season_2025_2026_gamestats.csv`

#### Step 2 — Fix Special Teams (H-Ref Backfill)
Fetches from **Hockey-Reference** (the authoritative source for PP/PK data) to correct NHL API's "ghost goals" problem, where some PP goals aren't credited properly.
- Updates `pp_goals`, `pp_opportunities`, `pp_goals_against`, `pk_opportunities` columns in gamestats

#### Step 3 — Re-Score Every Shot with the xG Model ⭐
Loads `xg_model_xgb.pkl` (the trained XGBoost model) and runs every shot in `nhl_season_2025_2026_shots.csv` through it.
- Features: spatial zone (5×5 grid), shot type, rebound flag, rush flag, off-wing, score state, time since last event
- Output: `xG` probability (0.0–1.0) for each shot
- Sanity check: mean xG across all shots should be ~0.07 (NHL average). If not, the model may be corrupted.
- Then aggregates by `(game_id, team_id, strength_state)` → updates `xG_for`, `xG_against`, `xG_for_5v5`, `xG_against_5v5` in gamestats

#### Step 4 — Recalculate Team Ratings
Calls `team_ratings.py` using the freshly re-scored gamestats.
- Computes `xgf_5v5_rating` and `xga_5v5_rating` per team
- Weighting: 50% EWMA (7-game half-life, emphasizes recent games) + 50% season average (regressed 10 games toward league mean)
- Also computes: `pp_rating`, `pk_rating`, `penalties_drawn_per_60`, `penalties_taken_per_60`, `gsax_per_game` per goalie
- Writes: `team_ratings.json`, `goalie_ratings.json`

#### Step 5 — Fetch MoneyPuck Player Data
Downloads the latest MoneyPuck player CSVs (updated nightly after games).
- `moneypuck_skaters.csv` — all skaters, all situations
- `moneypuck_goalies.csv` — all goalies
- `moneypuck_bios.csv` — player ID → name lookup

Then runs `player_impact.py` to transform these into:
- `relative_xgf_pct` (on-ice vs off-ice xGF% differential)
- `ev_xgf_per60`, `ev_xga_per60`, `ev_net_per60`
- `ind_xg_per60`, `ind_hd_xg_per60`
- `pp_xgf_per60`, `pk_xga_per60`

Applies Bayesian shrinkage: players with < 300s TOI pulled strongly toward league average. Writes: `player_impact.json`, `league_avg_impact.json`, `player_name_lookup.json`.

#### Step 6 — Fetch Upcoming Games + Lineups
Calls `fetch_upcoming.py` and `fetch_dailyfaceoff.py`:
- NHL API schedule for today + tomorrow → `upcoming_games.json`
- Daily Faceoff goalie confirmations → `dailyfaceoff_goalies.json`, `team_lineups.json`
- Goalie status: Confirmed / Likely / Unconfirmed

#### Step 7 — Fetch Odds
Calls `fetch_odds.py`:
- Primary: Bovada API moneyline for each NHL game
- Fallback: ESPN API if Bovada returns no data
- Writes: `odds.json`

#### Step 8 — Run Predictions
Calls `predict_games.py` (see full breakdown below).
- Writes: `predictions_detailed.csv`

#### Step 9 — Generate Prediction History
Calls `generate_history.py`:
- Reads `predictions_detailed.csv` + `gamestats.csv`
- For each historical game, checks if a frozen prediction exists; if not, re-simulates using current ratings
- Attaches actual results (scores, winner)
- Computes Brier score for calibration validation
- Writes: `prediction_history.json`

#### Step 10 — Backfill Player Boxscore Stats
Calls `backfill_player_stats.py`:
- Finds any game IDs in gamestats not yet in `player_stats.csv`
- Fetches boxscore from NHL API for each
- **Incremental:** skips already-processed games. Fast unless there were new games overnight.
- Writes: `nhl_season_2025_2026_player_stats.csv`

---

### `predict_games.py` — The Core Prediction Engine

> Runs: **Every run** (both Full Refresh and Lite Update)

This is what produces the numbers you see on the site. It runs on every hourly cycle so that lineup changes and odds shifts are reflected quickly.

**Full prediction pipeline for each game:**

#### 1. Base 5v5 xG (Team Ratings)
```
home_5v5_xg = (home_off_rating / league_avg) × (away_def_rating / league_avg) × 2.45
away_5v5_xg = (away_off_rating / league_avg) × (home_def_rating / league_avg) × 2.45
```
`2.45` is the target league-average 5v5 xG per team per game.

#### 2. Lineup-Aware 5v5 Adjustment (if player_impact.json available)
- Loads confirmed lines from `team_lineups.json`
- For each player on the confirmed lineup, looks up their `ev_net_per60` from `player_impact.json`
- Estimates what this specific lineup would generate in 5v5 xG
- **Blends 50/50 with team rating:** `final_5v5 = (lineup_estimate × 0.50) + (team_rating × 0.50)`
- Conservative blend to prevent noisy individual stats from overwhelming team-level signal

#### 3. Special Teams xG
```
pp_opps = (home_penalties_drawn_per60 + away_penalties_taken_per60) / 2
home_st_xg = pp_opps × 0.18 × home_pp_efficiency_factor
away_st_xg = pp_opps × 0.18 × away_pp_efficiency_factor
```
`0.18` = average xG generated per power play opportunity (NHL baseline).

#### 4. Schedule/Rest Adjustments
| Situation | xG Adjustment |
|-----------|--------------|
| Back-to-back | −0.26 xG |
| 3 games in 4 days | −0.10 xG |
| Home ice advantage | +0.16 xG (home team) |

#### 5. Goalie Impact
```
home_final_xg = home_5v5_xg + home_st_xg + home_rest_adj − (away_goalie_gsax × 0.5)
```
- `gsax_per_game` is shrunk toward 0 (goalies regress to league average)
- Clamped to ±1.0 per game so outliers don't break predictions

#### 6. Win Probability (Poisson Simulation)
- Simulates regulation outcomes using Poisson distribution with home/away xG as λ
- Overtime: 23% of games go to OT; coin-flip home/away in OT
- Final: `home_win_prob = P(home reg win) + (P(OT) × 0.5)`

#### 7. Expected Value & Wager Recommendation
```
EV = (model_win_prob × decimal_odds) − 1
```
- Positive EV → consider betting
- Wager sizing: Quarter-Kelly Criterion using EV magnitude and edge
- Output: `"Home 0.6 Units"`, `"Away 1.0 Unit"`, or `"No Bet"`

---

### `fetch_upcoming.py` — Schedule + Goalie Status

> Runs: **Every run**

- Hits NHL API for today's and tomorrow's schedule
- Cross-references Daily Faceoff for goalie confirmations
- Validates goalie names against historical team rosters (catches trades/call-ups)
- **If a starting goalie is Unconfirmed:** prediction still runs, uses most-likely starter from recent games
- Writes: `upcoming_games.json`

---

### `fetch_odds.py` — Vegas Moneylines

> Runs: **Every run**

- Primary source: **Bovada** API (live betting odds)
- Fallback: **ESPN** API
- Maps team names to internal naming convention (e.g., "Utah Hockey Club" → "Mammoth")
- Writes: `odds.json`
- **Note:** Odds are only used for EV calculation — they are **not** an input to the xG model itself.

---

### `backfill_player_stats.py` — Per-Player Boxscores

> Runs: **Every run** (incremental — fast unless new games exist)

- Checks which `game_id`s in `gamestats.csv` are missing from `player_stats.csv`
- Fetches NHL API boxscore for each missing game
- Parses skater stats: G, A, Pts, +/−, TOI, shots, hits, blocks, PIM, PPG, SHG
- Parses goalie stats: SA, SV, GA, SV%, W/L/OT decision
- **Frontend impact:** Powers the player stats grid and availability strip in the UI
- **xG impact:** None — display data only

---

### `snapshot_predictions.py` — SiteHistory Archive

> Runs: **Every run**

- Reads `predictions_detailed.csv` (current run's predictions)
- Appends a new run-stamped row to `public/data/SiteHistory/YYYY-MM-DD.csv`
- Re-formats all rows (odds, percentages, starter names) for consistency
- Backfills `bet` column and `starter` abbreviations for earlier rows in the same day
- Tracks how predictions evolved throughout the day as lineups/odds updated
- **Frontend impact:** Powers the SiteHistory tab
- **xG impact:** None — logging/archive only

---

### `season_simulator.py` — Playoff Odds

> Runs: **Every run** — 5,000 Monte Carlo simulations

- Fetches current NHL standings from NHL API
- Loads remaining schedule from `remaining_schedule.json`
- For each simulation, plays out remaining games using team win probabilities derived from `team_ratings.json`
- Tracks: playoff berths, division titles, conference titles, Stanley Cup wins
- **xG impact:** Indirect — uses xG-based team ratings as win probability input
- Writes: `season_projections.json`
- **Note:** With ~5,000 simulations, this takes ~2–3 minutes and runs in *every* pipeline cycle

---

### `generate_history.py` — Historical Prediction Record

> Runs: **Full Refresh only** (~3× per day)

- Loads all historical games from `gamestats.csv`
- For each game, checks if a valid frozen prediction exists in `predictions_detailed.csv`
- If yes: uses the frozen prediction (prevents retroactive drift)
- If no (backfill case): re-simulates using current team ratings as of that game date
- Attaches actual results and computes **Brier score** (calibration metric — lower is better)
- **Frontend impact:** Powers the History tab
- Writes: `prediction_history.json`

---

### `xg_model.py` + `xg_model_xgb.pkl` — The Shot Quality Model

> Re-applied: **Full Refresh only** (~3× per day)

This is the foundational ML model. It is **not retrained** as part of the regular pipeline — it was trained once on historical data and the pickle file is stored in the repo.

**Input features per shot:**
| Feature | Description |
|---------|-------------|
| `spatial_bin` | 5×5 zone grid (25 zones) — most important feature |
| `shot_type` | Wrist / snap / backhand / tip / slap / deflection |
| `is_rebound` | Shot within 3 seconds of a save |
| `is_rush` | Shot on a rush sequence |
| `is_off_wing` | Player shooting from non-dominant side |
| `score_state` | Goal differential at time of shot |
| `time_since_last_event` | Transition speed |

**Output:** Probability (0.0–1.0) that the shot results in a goal.

**Validation:** Mean xG across all shots ≈ 0.07 (NHL average). The pipeline checks this on every Full Refresh.

> ⚠️ **To retrain the model**, you must manually run `train_xg_model.py`. It is never called automatically.

---

## 4. What Goes Into the Final xG Prediction

Here is the complete lineage of every number in `predictions_detailed.csv`:

```
FINAL xG PREDICTION
│
├── 5v5 xG (50% weight)
│   ├── Team Ratings [team_ratings.json]
│   │   ├── xgf_5v5_rating ──→ from gamestats.csv
│   │   │                        └── xG_for_5v5 per game
│   │   │                              └── SUM of shot xG values
│   │   │                                    └── xg_model_xgb.pkl scores each shot
│   │   │                                          └── nhl_season_2025_2026_shots.csv
│   │   │                                                └── NHL API play-by-play
│   │   └── EWMA (7-game half-life) + regression to league mean
│   │
│   └── Lineup Estimate (50% blend, if available)
│       ├── player_impact.json [ev_net_per60 per player]
│       │     └── MoneyPuck CSVs (nightly update)
│       └── team_lineups.json [confirmed lines]
│             └── Daily Faceoff scraper
│
├── Special Teams xG
│   ├── pp_rating / pk_rating [team_ratings.json]
│   │     └── from gamestats.csv
│   │           └── H-Ref PP/PK data (authoritative) backfilled into NHL API data
│   └── penalties_drawn/taken_per60 [team_ratings.json]
│
├── Schedule Adjustments
│   └── Back-to-back, 3-in-4, home ice
│         └── gamestats.csv (game dates)
│               └── NHL API
│
├── Goalie Adjustment
│   └── gsax_per_game [goalie_ratings.json]
│         └── from gamestats.csv (goals against vs xG against)
│               └── xg_model_xgb.pkl (expected goals)
│
└── Win Probability → EV → Wager Recommendation
      └── odds.json [Bovada/ESPN]
```

### Components by Update Frequency

| Component | Updates | How Often |
|-----------|---------|-----------|
| Individual shot xG scores | `refresh_pipeline.py` | ~3× / day |
| Team xG ratings (5v5) | `refresh_pipeline.py` | ~3× / day |
| Goalie GSAx ratings | `refresh_pipeline.py` | ~3× / day |
| Player impact scores | `refresh_pipeline.py` | ~3× / day |
| Special teams rates | `refresh_pipeline.py` | ~3× / day |
| Starting goalies / lineups | `fetch_upcoming.py` | Every run (~hourly) |
| Vegas odds | `fetch_odds.py` | Every run (~hourly) |
| Game prediction output | `predict_games.py` | Every run (~hourly) |

---

## 5. Every Output File — What It Is, Who Writes It, How Often

### Core Prediction Files

| File | Location | Written By | Frequency | Frontend Use | xG Input? |
|------|----------|-----------|-----------|--------------|-----------|
| `predictions_detailed.csv` | `data/` + `public/data/` | `predict_games.py` | Every run | Today's predictions tab | Uses xG ratings |
| `last_updated.json` | `data/` + `public/data/` | `predict_games.py` | Every run | "Last updated" timestamp | No |
| `prediction_history.json` | `data/` | `generate_history.py` | Full Refresh | History tab | Uses xG ratings |
| `SiteHistory/YYYY-MM-DD.csv` | `public/data/SiteHistory/` | `snapshot_predictions.py` | Every run | SiteHistory tab | Archive only |

### Model & Ratings Files

| File | Location | Written By | Frequency | Frontend Use | xG Input? |
|------|----------|-----------|-----------|--------------|-----------|
| `team_ratings.json` | `public/data/` | `refresh_pipeline.py` | Full Refresh | Team ratings display | ✅ Core input |
| `goalie_ratings.json` | `public/data/` | `refresh_pipeline.py` | Full Refresh | Goalie stats | ✅ Core input |
| `player_impact.json` | `pipeline/` + `public/data/` | `refresh_pipeline.py` | Full Refresh | Player IMP tab | ✅ 5v5 adjustment |
| `league_avg_impact.json` | `pipeline/` + `public/data/` | `refresh_pipeline.py` | Full Refresh | IMP baseline | ✅ Normalization |
| `player_name_lookup.json` | `pipeline/` | `refresh_pipeline.py` | Full Refresh | Internal name mapping | No |

### Raw Data Files

| File | Location | Written By | Frequency | Frontend Use | xG Input? |
|------|----------|-----------|-----------|--------------|-----------|
| `nhl_season_2025_2026_gamestats.csv` | `pipeline/` | `refresh_pipeline.py` | Full Refresh | Internal only | ✅ Foundation |
| `nhl_season_2025_2026_shots.csv` | `pipeline/` | `refresh_pipeline.py` | Full Refresh | Internal only | ✅ Foundation |
| `gamestats.csv` | `public/data/` | `refresh_pipeline.py` | Full Refresh | Stats tables | Derived from above |
| `nhl_season_2025_2026_player_stats.csv` | `public/data/` | `backfill_player_stats.py` | Every run | Player stat rows | No |
| `player_bio.json` | `public/data/` | `refresh_pipeline.py` | Full Refresh | Player cards | No |
| `contracts.json` | `public/data/` | `refresh_pipeline.py` | Full Refresh | Contract display | No |

### Live Data Files

| File | Location | Written By | Frequency | Frontend Use | xG Input? |
|------|----------|-----------|-----------|--------------|-----------|
| `odds.json` | `pipeline/` + `data/` + `public/data/` | `fetch_odds.py` | Every run | Odds display | EV calc only |
| `upcoming_games.json` | `pipeline/` | `fetch_upcoming.py` | Every run | Game list | Game input |
| `dailyfaceoff_goalies.json` | `pipeline/` | `fetch_upcoming.py` | Every run | Starter status | Goalie selection |
| `team_lineups.json` | `pipeline/` + `public/data/` | `fetch_upcoming.py` | Every run | Lineup display | ✅ 5v5 adjustment |

### Season Simulation

| File | Location | Written By | Frequency | Frontend Use | xG Input? |
|------|----------|-----------|-----------|--------------|-----------|
| `season_projections.json` | `pipeline/data/` + `public/data/` | `season_simulator.py` | Every run | Standings/playoff odds | Via team ratings |

---

## 6. Data Source Inventory

| Source | What We Get | Used In | How Often Fetched |
|--------|------------|---------|-------------------|
| **NHL API** (api-web.nhle.com) | Play-by-play, shots, boxscores, schedule, standings, goalies | `nhl_scraper_poc.py`, `fetch_upcoming.py`, `backfill_player_stats.py`, `season_simulator.py` | Full Refresh + every run |
| **Hockey-Reference** | Authoritative PP/PK goals and opportunities | `fetch_href_stats.py` → `backfill_special_teams.py` | Full Refresh |
| **MoneyPuck** | Per-player xGF%, xG/60, on-ice metrics | `fetch_moneypuck.py` → `player_impact.py` | Full Refresh |
| **Bovada** | Live moneyline odds | `fetch_odds.py` | Every run |
| **ESPN** | Moneyline odds (fallback) | `fetch_odds.py` | Every run (if Bovada fails) |
| **Daily Faceoff** | Starting goalie confirmations, team lines | `fetch_dailyfaceoff.py` → `fetch_upcoming.py` | Every run |
| **PostgreSQL DB** | *(via DB_HOST/DB_NAME secrets)* | Referenced in env but actual DB queries are via the above CSVs | — |
| **`xg_model_xgb.pkl`** | Shot quality scoring | `refresh_pipeline.py` | Loaded every Full Refresh |

---

## 7. Staleness Risk Register

Issues that could cause silent data staleness you might not notice immediately:

### 🔴 High Risk

| Issue | Impact | How to Detect |
|-------|--------|---------------|
| **`xg_model_xgb.pkl` is never auto-retrained** | Team ratings drift if shot quality patterns change | Check `train_xg_model.py` was run recently; mean xG should be ~0.07 |
| **Bovada API returns empty odds** | EV and wager recommendations go blank; model still predicts | Check `odds.json` — values should be non-zero for today's games |
| **Daily Faceoff scraper fails** | All goalies show as Unconfirmed; model falls back to last-known starter | Check `dailyfaceoff_goalies.json` — entries for today's date should exist |
| **MoneyPuck CSVs not updated** | Player impact scores use stale data; lineup adjustments degraded | MoneyPuck updates nightly; if a game ran last night, check `moneypuck_skaters.csv` modification date |

### 🟡 Medium Risk

| Issue | Impact | How to Detect |
|-------|--------|---------------|
| **DST offset bug in full refresh window** | Full refresh window is now 7–9 AM CDT instead of 6–8 AM CST (shifted 1 hr later). Comment in workflow says "Assuming UTC-6 (Winter)" but we're on UTC-5. | Not breaking, but morning refreshes happen later in the day than designed |
| **H-Ref scrape fails** | PP/PK stats not corrected; team ratings slightly off for teams with abnormal PP activity | Check `href_stats.csv` modification date |
| **`season_simulator.py` runs on every lite update** | At 5,000 simulations, this adds ~2–3 minutes to every run including lite updates | It always runs; the question is whether playoff odds need hourly precision |
| **`generate_history.py` only in Full Refresh** | History tab is up to 21+ hours stale if viewing in the evening | History tab shows yesterday's final state until ~7–9 AM CDT next day |

### 🟢 Low Risk (by design)

| Behavior | Why It's Intentional |
|----------|---------------------|
| Team ratings don't change between lite updates | The 50/50 EWMA blend already dampens single-game noise; hourly re-rating would be noisy |
| `prediction_history.json` uses frozen predictions | Prevents retroactive model drift from changing what "we predicted" on a past date |
| Player impact is a 50% blend (not 100%) | Prevents noisy individual stats from dominating the team-level signal |
| Goalie GSAx clamped to ±1.0/game | A goalie can't add/remove more than 1 expected goal per game in the model |

---

*Last reviewed: March 2026*
