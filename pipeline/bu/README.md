# `pipeline/bu/`: bottom-up model

The bottom-up (BU) model is the player-impact, lineup-adjusted xG and game-state model. Its design doc is `DESIGN.md` (v2, 2026-10-01). It is built milestone by milestone (DESIGN §8); this file covers what has landed so far.

Run everything from `pipeline/`, so that the shared helpers (`http_utils`, `season`) import as top-level modules:

```bash
cd pipeline
python -m bu.lake.backfill --help
```

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
