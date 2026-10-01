# Pregame snapshots (forward archive)

Prices, starting goalies, lineups and injury reports as they stood at a given
minute cannot be downloaded later from any free source. The snapshot job
saves them as they happen, so the 2026-27 market tests (closing-line
movement, blend vs close) have timestamped data. Design: DESIGN.md §2.4
(M0a); tests: `pipeline/bu/preregistration.yaml`.

## Pieces

| Piece | Path | Job |
|---|---|---|
| Capture job | `pipeline/bu/snapshots.py` | Reads the schedule, captures the selected games, appends rows |
| Archive | `pipeline/snapshots/<season>/<ET date>.jsonl.gz` | Tracked in git, append-only, ~1 KB per row |
| Release copy | release `snapshots-<season>` | Same day files, uploaded on every run (`--clobber`) |
| Workflow | `.github/workflows/odds_close.yml` | Runs the job, commits, pushes, uploads |
| Trigger | `infra/cloudflare-snapshot-worker/` | Dispatches the workflow 8-13 min before each start (SETUP.md) |
| Pre-registration | `pipeline/bu/preregistration.yaml` + `prereg_analysis.py` | What the archive will be used to test, frozen before any data |

## When it runs

- **Close capture** (window 25 min): the Cloudflare Worker dispatches the
  workflow when a game is 8-13 minutes from its scheduled start, so each
  game gets a row inside the 15-minute "close" window. GitHub crons at :17 and
  :47 (15:00-03:59 UTC) are the fallback for the usual :30 / :00 start slots.
  Set the repository variable `SNAPSHOT_CRON=off` to stop the fallback crons
  once the Worker is live.
- **Slate sweep** (window 24 h): 15:07 UTC every day, all of today's games.
  This is the earliest game-day price (q0) for the line-movement test.
- **Manual:** Actions → *Odds close snapshots* → *Run workflow*
  (window in minutes, optional game ids).

Cost: about 27 GitHub runs a day at ~1 billed minute each (~800 min/month)
while the fallback crons are on; ~30 min/month for the sweep alone once
`SNAPSHOT_CRON=off`. The Worker is free.

## Row format (schema v1)

One JSON object per game per run:

```text
v, game_id, game_date (ET), season ("2026-27"), game_type ("02"), start_utc,
captured_at, lead_min, state, home, away, trigger, run, h (content hash)
prices[]   one per book/source: book, source, fetched_at, home_ml, away_ml,
           total_line, over, under, pl_spread (home), pl_home, pl_away,
           three_way_home/away/tie, ml_1p_home/away, open{...} (ESPN only,
           untimestamped reference)
goalies    {home, away}: DailyFaceoff name, status, dfo_id, news_at, fetched_at
lineups    {home, away}: DailyFaceoff source, updated_at, fetched_at,
           lines{f1..f4,d1..d3,g: [[dfo_id, name]]}, out[[id, name, status, list]], gtd[[id, name]]
injuries   {home, away}: ESPN name, status, type, date, return, pos (no comment text)
published  the site's prediction at capture time: model_version, predicted_at,
           home_model_pct, home_win_pct, blend_weight, home_market_pct,
           market_source, market_fetched_at, home_gp, away_gp, bu_shadow_home_win_pct
errors     sources that failed on this run
```

Sources: NHL partner feed (DraftKings) and Bovada through the
`fetch_odds.py` parsers, ESPN scoreboard (its listed provider, usually
DraftKings), DailyFaceoff, ESPN injuries. Each book keeps its own row and
`fetched_at`; nothing is merged across books. ESPN is called with Python's
own `Python-urllib/3.x` user agent: its edge currently answers 403 to a bare
`Mozilla/5.0`.

Price classes (DESIGN §1.4): *close* when 0 < lead ≤ 15 min, *snapshot*
otherwise; prices at or after the start are never used. The close of a game
for a book is its last close-class price.

Reliability: each source is optional (a failure lands in `errors`, never
stops the run); a run appends one gzip member per day file and never
rewrites earlier bytes; a row whose content matches a row stored for the
same game less than 3 minutes earlier is skipped (retries and double
triggers do not duplicate); readers tolerate a truncated last member.

## Commands (from `pipeline/`)

```bash
python3 -m bu.snapshots --dry-run --window 1440          # see what a slate sweep would store
python3 -m bu.snapshots --window 25                      # close capture now
python3 -m bu.snapshots report --since 2026-10-01         # close coverage per book (M0a gate: >= 80%)
python3 -m bu.prereg_analysis --test M-1                  # registered analysis (adds --record for a look)
```

Python readers: `bu.snapshots.load_rows`, `price_rows` (flat per-book
records with `lead_min` and `class`), `closes`, `earliest`, `coverage`.

## Checks

- M0a gate: at least 80% of the first week's games have a close
  (`report`'s `gate_m0a_80pct`), and the day files are in git and in the
  release. If GitHub cron alone misses too many, set up the Worker
  (`infra/cloudflare-snapshot-worker/SETUP.md`).
- Tests: `pipeline/tests/test_snapshot_job.py`, `test_snapshot_workflow.py`,
  `test_snapshot_prereg.py`; Worker: `npx vitest run infra`.
