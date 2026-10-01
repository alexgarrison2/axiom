"""Event / shift / roster data lake, 2010-11 onward (DESIGN §2.1-2.3, §2.6, M0b).

Modules:
  paths     lake layout under data/lake/ (gitignored)
  sources   endpoint catalogue (explicit season ids, payload classification)
  ratelimit per-host request spacing (<= 2 rps, DECISIONS D5)
  fetch     resumable raw fetcher + manifest
  parse     raw payloads -> games/events/shifts/lineups (sides, strength, on-ice)
  sides     rink-side inference where homeTeamDefendingSide is missing
  onice     on-ice skaters/goalies per event from shift charts
  crosswalk player ID crosswalk (NHL id <-> names/teams/numbers, bio)
  build     per-season parquet tables
  dq        data-quality gate (DESIGN §2.6) -> JSON report
  backfill  CLI: python -m bu.lake.backfill --seasons 2010-2026 --rps 2
"""
