"""Lake backfill CLI (DESIGN §2.2, M0b).  Run from ``pipeline/``:

    python -m bu.lake.backfill --seasons 2010-2026 --rps 2          # full backfill (resumable)
    python -m bu.lake.backfill --seasons 2010-2026 --estimate        # plan + time/disk estimate only
    python -m bu.lake.backfill --seasons 2010,2015,2019,2023,2026 --sample 4   # validation sample
    python -m bu.lake.backfill --seasons 2026 --rps 2                # incremental current season

``--seasons`` takes season *start* years (2010 = 2010-11).  Phases:

  0. game lists       api.nhle.com/stats/rest/en/game?cayenneExp=season=...   (1 call / season;
                      always refreshed for the current season)
  1. per game         pbp, boxscore, right-rail (api-web) ∥ shift charts (api.nhle.com);
                      final games of the requested types only; priority window first
  2. team rosters     api-web /v1/roster/{team}/{season}  (crosswalk + bio)
  3. build            per-season parquet (bu.lake.build)
  4. DQ gate          bu.lake.dq -> data/lake/dq/dq_report_latest.json

Every host is limited to ``--rps`` request starts per second (D5: <= 2).  Ctrl-C
is safe; re-run the same command to resume.  A throughput estimate (achieved
rps, latency, bytes) and the projected time/disk for the remaining backfill are
printed at the end and written to data/lake/dq/throughput_latest.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict

from .build import build_season, sample_games, schedule_games
from .fetch import Fetcher, Task, compact_manifest, read_raw
from .paths import Lake
from .sources import DEFAULT_ENDPOINTS, ENDPOINTS, GAME_ENDPOINTS, season_id

# Mean gzip bytes per payload measured on the 2026-10-01 validation sample; used
# for disk projections before the run has its own numbers.
DEFAULT_GZ_BYTES = {"pbp": 14_000, "boxscore": 4_000, "rightrail": 3_000, "shifts": 17_000, "roster": 3_500}
DEFAULT_LATENCY = {"api-web.nhle.com": 0.25, "api.nhle.com": 0.15}


def current_start_year() -> int:
    from season import START_YEAR
    return int(START_YEAR)


def parse_seasons(spec: str) -> list[int]:
    out: set[int] = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            a, b = int(a[:4]), int(b[:4])
            out.update(range(min(a, b), max(a, b) + 1))
        else:
            out.add(int(part[:4]))
    cur = current_start_year()
    bad = [s for s in out if s < 2010 or s > cur]
    if bad:
        raise SystemExit(f"--seasons out of range (2010..{cur}): {sorted(bad)}")
    return sorted(out)


def priority_order(start_years, priority_from: int) -> list[int]:
    """Priority window (>= priority_from) newest first, then older seasons newest first."""
    hi = sorted((s for s in start_years if s >= priority_from), reverse=True)
    lo = sorted((s for s in start_years if s < priority_from), reverse=True)
    return hi + lo


def season_teams(lake: Lake, season: str, game_ids) -> list[str]:
    """Team abbreviations of ``season`` from the raw PBP/boxscore payloads."""
    want_ids, abbrevs = set(), {}
    sched = schedule_games(lake, season)
    if len(sched):
        want_ids = set(sched["home_team_id"]) | set(sched["away_team_id"])
    for gid in game_ids:
        for ep in ("pbp", "boxscore"):
            p = lake.raw_path(ep, season, gid)
            if os.path.exists(p):
                d = read_raw(p)
                for side in ("homeTeam", "awayTeam"):
                    t = d.get(side) or {}
                    if t.get("id") is not None and t.get("abbrev"):
                        abbrevs[t["id"]] = t["abbrev"]
                break
        if want_ids and want_ids <= set(abbrevs):
            break
    return sorted(set(abbrevs.values()))


def estimate(lake: Lake, fetcher: Fetcher, plan: dict[str, list[int]], endpoints, rps: float,
             workers: int, observed: dict | None = None) -> dict:
    """Remaining requests, hours and disk per host for ``plan`` (season -> game ids)."""
    remaining = defaultdict(int)
    per_ep = defaultdict(int)
    for season, gids in plan.items():
        for ep in endpoints:
            if ep == "roster":
                sched = schedule_games(lake, season)
                n_team = len(set(sched["home_team_id"]) | set(sched["away_team_id"])) if len(sched) else 32
                d = os.path.join(lake.raw_dir, "roster", season)
                have = len([f for f in os.listdir(d) if f.endswith(".json.gz")]) if os.path.isdir(d) else 0
                n = max(0, n_team - have) if gids else 0
            else:
                n = len(fetcher.pending([Task(ep, season, str(g)) for g in gids]))
            host = ENDPOINTS[ep].host()
            remaining[host] += n
            per_ep[ep] += n
    hosts = {}
    for host, n in remaining.items():
        lat = DEFAULT_LATENCY.get(host, 0.25)
        obs = (observed or {}).get(host) or {}
        if obs.get("mean_latency_s"):
            lat = obs["mean_latency_s"]
        eff = min(rps, workers / max(lat, 1e-3))
        hosts[host] = {"requests": n, "hours_at_rps": round(n / rps / 3600, 2),
                       "effective_rps": round(eff, 2), "hours_effective": round(n / eff / 3600, 2)}
    gz = dict(DEFAULT_GZ_BYTES)
    for obs in (observed or {}).values():
        for ep, v in (obs.get("by_endpoint") or {}).items():
            if v.get("n"):
                gz[ep] = v["bytes_gz"] / v["n"]
    disk = sum(per_ep[ep] * gz.get(ep, 5_000) for ep in per_ep)
    crit = max((h["hours_effective"] for h in hosts.values()), default=0.0)
    return {"rps": rps, "workers_per_host": workers, "hosts": hosts, "requests_by_endpoint": dict(per_ep),
            "critical_path_hours": crit, "projected_raw_gb": round(disk / 1e9, 2),
            "projected_parquet_gb": round(disk / 1e9 * 0.35, 2)}


def print_estimate(est: dict, title: str, log=print):
    log(f"\n== {title} ==")
    for host, h in est["hosts"].items():
        log(f"  {host:<20} {h['requests']:>7,} requests | {h['hours_at_rps']:>6.2f} h at {est['rps']} rps | "
            f"{h['hours_effective']:>6.2f} h at the effective {h['effective_rps']} rps")
    log(f"  by endpoint: {est['requests_by_endpoint']}")
    log(f"  critical path ≈ {est['critical_path_hours']:.2f} h (hosts run in parallel); "
        f"raw ≈ {est['projected_raw_gb']} GB gz, parquet ≈ {est['projected_parquet_gb']} GB")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.lake.backfill", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default=None, help="Start years, e.g. 2010-2026 or 2010,2015 (default: current)")
    ap.add_argument("--rps", type=float, default=2.0, help="Max request starts per second per host (<= 2)")
    ap.add_argument("--workers-per-host", type=int, default=2)
    ap.add_argument("--game-types", default="2,3", help="NHL game types (02 regular, 03 playoffs)")
    ap.add_argument("--endpoints", default=",".join(DEFAULT_ENDPOINTS))
    ap.add_argument("--sample", type=int, default=0, help="Only N evenly spaced games per season")
    ap.add_argument("--games", default="", help="Explicit game ids (comma-separated)")
    ap.add_argument("--priority-from", type=int, default=2018, help="Fetch seasons >= this first")
    ap.add_argument("--estimate", action="store_true", help="Print the plan and time/disk estimate, then stop")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--build-only", action="store_true", help="Skip fetching; rebuild parquet + DQ")
    ap.add_argument("--no-dq", action="store_true")
    ap.add_argument("--strict-dq", action="store_true", help="Exit 2 when the DQ gate fails")
    ap.add_argument("--jobs", type=int, default=max(1, min(8, (os.cpu_count() or 2) - 1)))
    ap.add_argument("--retry-failed", action="store_true", help="Also retry 404s from closed seasons")
    ap.add_argument("--max-requests", type=int, default=None, help="Stop after N HTTP requests")
    ap.add_argument("--lake-dir", default=None, help="Lake root (default data/lake or $PONYXG_LAKE_DIR)")
    args = ap.parse_args(argv)

    if args.rps > 2.0:
        print(f"[WARN] --rps {args.rps} exceeds the approved polite rate (D5: <= 2 per host)")
    lake = Lake(args.lake_dir)
    cur = current_start_year()
    years = parse_seasons(args.seasons) if args.seasons else [cur]
    gtypes = tuple(int(x) for x in args.game_types.split(",") if x.strip())
    endpoints = [e.strip() for e in args.endpoints.split(",") if e.strip()]
    unknown = [e for e in endpoints if e not in ENDPOINTS or e == "schedule"]
    if unknown:
        raise SystemExit(f"unknown endpoints: {unknown}")
    explicit = {int(g) for g in args.games.split(",") if g.strip()}
    if explicit:
        years = sorted({int(str(g)[:4]) for g in explicit} | (set(years) if args.seasons else set()))
    seasons = [season_id(y) for y in priority_order(years, args.priority_from)]
    print(f"bu.lake.backfill — lake {lake.root}\n  seasons {', '.join(seasons)} | types {gtypes} | "
          f"endpoints {endpoints} | {args.rps} rps/host x {args.workers_per_host} workers")

    fetcher = Fetcher(lake, rps=args.rps, workers_per_host=args.workers_per_host,
                      retry_failed=args.retry_failed, current_start_year=cur, max_requests=args.max_requests)
    t0 = time.monotonic()

    # Phase 0: game lists.
    if not args.build_only:
        for s in seasons:
            t = Task("schedule", s, s)
            st = fetcher.fetch_one(t, force=int(s[:4]) >= cur)
            if st not in ("ok", "cached"):
                print(f"  [WARN] game list for {s}: {st}")
    plan: dict[str, list[int]] = {}
    full_plan: dict[str, list[int]] = {}
    for s in seasons:
        sched = schedule_games(lake, s, gtypes)
        ids = [int(g) for g in sched["game_id"]] if len(sched) else []
        full_plan[s] = ids
        if explicit:
            ids = sorted(g for g in explicit if str(g).startswith(s[:4]))
        elif args.sample:
            ids = sample_games(ids, args.sample)
        plan[s] = ids
    print("  games: " + ", ".join(f"{s}: {len(plan[s])}" + (f"/{len(full_plan[s])}" if len(plan[s]) != len(full_plan[s]) else "")
                                   for s in seasons))

    est0 = estimate(lake, fetcher, plan, endpoints, args.rps, args.workers_per_host)
    print_estimate(est0, "Plan for this run")
    if args.estimate:
        if plan != full_plan:
            print_estimate(estimate(lake, fetcher, full_plan, endpoints, args.rps, args.workers_per_host),
                           "Full backfill of the requested seasons")
        return 0

    # Phase 1 + 2: per-game endpoints (all hosts in parallel), then rosters.
    if not args.build_only:
        game_eps = [e for e in endpoints if e in GAME_ENDPOINTS]
        tasks = [Task(ep, s, str(g)) for s in seasons for g in plan[s] for ep in game_eps]
        res = fetcher.run(tasks, label="games")
        print(f"  games phase: {res}")
        if "roster" in endpoints:
            rtasks = [Task("roster", s, abbr) for s in seasons for abbr in season_teams(lake, s, plan[s])]
            res = fetcher.run(rtasks, label="rosters")
            print(f"  rosters phase: {res}")
        compact_manifest(lake)

    observed = {h: st.as_dict() for h, st in fetcher.stats.items()}
    throughput = {"elapsed_s": round(time.monotonic() - t0, 1), "hosts": observed}
    if observed:
        print("\n== Throughput (this run) ==")
        for h, o in observed.items():
            gz = (o["bytes_gz"] / o["ok"]) if o["ok"] else 0
            rate = "n/a" if o["achieved_rps"] is None else f"{o['achieved_rps']:.2f}"
            print(f"  {h:<20} {o['requests']:>6} requests in {o['elapsed_s']:>7.1f} s = {rate} rps "
                  f"| mean latency {o['mean_latency_s']} s | {o['ok']} ok, {o['empty']} empty/not final, "
                  f"{o['missing']} 404, {o['errors']} errors | mean {gz / 1000:.1f} KB gz")
    est_full = estimate(lake, fetcher, full_plan, endpoints, args.rps, args.workers_per_host, observed)
    print_estimate(est_full, "Remaining full backfill of the requested seasons (measured rates)")
    throughput["remaining_full_backfill"] = est_full
    os.makedirs(lake.dq_dir, exist_ok=True)
    throughput["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    throughput["argv"] = list(argv) if argv is not None else sys.argv[1:]
    with open(os.path.join(lake.dq_dir, "throughput_latest.json"), "w") as f:
        json.dump(throughput, f, indent=2, default=str)
    if observed:
        with open(os.path.join(lake.dq_dir, "throughput_history.jsonl"), "a") as f:
            f.write(json.dumps({k: throughput[k] for k in ("finished_at", "argv", "elapsed_s", "hosts")},
                               default=str) + "\n")

    # Phase 3: build.
    built = []
    if not args.no_build:
        for s in sorted(seasons):
            if plan[s]:
                build_season(lake, s, plan[s] if (explicit or args.sample) else None, jobs=args.jobs)
                built.append(s)

    # Phase 4: DQ gate.
    if not args.no_dq and built:
        from .dq import run_dq, summarize
        targets = {s: plan[s] for s in built}
        report = run_dq(lake, built, targets=targets, full_targets={s: full_plan[s] for s in built})
        path = report["path"]
        print(summarize(report))
        print(f"  DQ report: {path}")
        if args.strict_dq and not report["pass"]:
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
