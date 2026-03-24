# 🏒 HockeyData — Master To-Do List

> **Last updated:** 2026-03-24 14:30

---

## 🎨 1. Visual / UI Tweaks

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 1.1 | **Skaters page: Rookies filter button** — Add a "Rookies" toggle button (similar to position filters) that filters the skaters table to only show players with `isRookie: true` | 🟡 Medium | ⚡ Small (~1 hr) | `isRookie` flag already exists in `player_bio.json` and is fetched by `SkaterStatsTable.tsx` |
| 1.2 | **Teams page: Clinch/elimination icons** — Display P/Z/Y/X/E badges next to team names in standings. Figma ref: https://www.figma.com/design/jmpyG8WAPoOr0OcJsDlbGw/Supotsu?node-id=580-331 | 🟡 Medium | 🔧 Medium (~2-3 hrs) | Need to determine clinch/elimination status from standings data |
| 1.3 | **Teams page: Column group toggles** — Default all column groups on; selected state: bg `#25DBEB`, font `#343434` | 🟢 Low | 🔧 Medium (~2-3 hrs) | UX improvement for dense table |

---

## 🧠 2. Core Model Improvements

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 2.1 | **Expand training data to 4+ seasons** — Incorporate 2022-23 PBP data (already scraped in `data/historical_pbp/`) to go from 3→4 seasons of training. More data = better generalization | 🔴 High | 🔧 Medium (~2-3 hrs) | Raw PBP exists, needs shot feature extraction + gamestats generation |
| 2.2 | **Tighten prediction clip range** — Currently [0.15, 0.85] but 85% bin is still miscalibrated (predicted 85%, actual 76%). Consider [0.25, 0.75] or data-driven clipping | 🟡 Medium | ⚡ Small (~30 min) | Quick calibration improvement at extremes |

---

## 🤕 3. Model Concerns / Investigations

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 3.1 | **GSAx calibration issue** — Only 3 teams have negative GSAx. Doesn't align with Natural Stat Trick, HockeyStats, MoneyPuck. Possible xG inflation in our shot model | 🔴 High | 🔍 Investigation (~1-2 days) | Could indicate our xG model is systematically low, making most goalies look "good". Need to compare our xG/shot vs industry benchmarks |
| 3.2 | **History tab correctness tracking** — Currently marks "Correct" based on which team scored more goals. Now win% and xG can disagree. Need to decide: track by win% favorite, xG favorite, or both? | 🟡 Medium | 🔧 Medium (~2-3 hrs) | Recommend switching to win% as primary correctness metric since that's our actual prediction |
| 3.3 | **Will Borgen / EV Defense investigation** — Will Borgen is appearing as #1 EV Defender by RAPM. Investigate whether this is a data artifact (small sample, teammate effects, xG suppression in limited role) or if it's legitimate | 🟡 Medium | 🔍 Investigation (~1-2 hrs) | Check TOI, zone starts, teammates on ice, and compare to industry RAPM sources |

---

## 📋 4. Feature Development

| # | Task | Priority | Effort | Notes |
| --- | ------ | ---------- | -------- | ------- |
| 4.1 | **Playoffs tab: Magic/Tragic number cleanup** — Hide Tragic Number once clinched; hide Magic Number once eliminated. Fix teams showing >0 numbers despite being officially clinched/eliminated | 🟡 Medium | 🔧 Medium (~3-4 hrs) | Need to cross-reference official clinch/elimination status with calculated numbers |
| 4.2 | **Teams page: Blown Leads & Comeback Wins columns** — 8 new columns: BL, BL(3P), BL(2+), BL(3+), CW, CW(3P), CW(2+), CW(3+) | 🟢 Low | 🔨 Large (~1-2 days) | Requires parsing PBP or game score progression data to determine lead states at various points. Fun feature but not model-impacting |
| 4.3 | **Pipeline: Daily Raw PBP Updater** — Create a script to append only new yesterday games to `raw_pbp_20252026.csv` instead of a full rebuild, and hook it into the automated daily GitHub action pipeline. | 🟡 Medium | ⚡ Small (~1 hr) | Keeps the comprehensive historical raw data up-to-date daily without needing a massive 15-minute scrape |

---

## 🚀 5. Long-Term / Exploration

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 5.1 | **Goalies page** — Full goalie stats tab (equivalent to Skaters tab) with GSAx, SV%, GP, record, trends | 🟢 Low | 🔨 Large (~2-3 days) | Design + data pipeline + frontend. Good candidate for after model stabilizes |

---

## 📝 6. Other Notes

-

---

## ✅ 7. Completed

| Date | Task | Commit |
|------|------|--------|
| 2026-03-24 14:00 | Visual: Rookie names in #D9FF82 (102 rookies via NHL stats API), bet pill colors (green=+EV+win, amber=+EV+lose), mobile total pill moved under History | `78f6fe4f` |
| 2026-03-24 12:15 | Phase 3C: Flurry-adjusted xG applied to 263K historical shots + re-aggregated gamestats. Backtest LL 0.6865→0.6830, accuracy 53.9%→54.9%, blended ECE 0.0189 | `e902eadd` |
| 2026-03-24 10:45 | Phase 2C: Data-driven OT model (70/30 OT/SO split, 5-season empirical) + Poisson features for ML (22→24 features). Backtest LL 0.6877→0.6865, ECE 0.0498→0.0386 | `1369421c` |
| 2026-03-24 10:30 | Validation: Full backtest run — baseline LL=0.6877, ECE=0.0498, 50-55% bucket at 48% accuracy. Identified OT modeling and calibration as top priorities | — |
| 2026-03-24 08:35 | Increase win% text size on desktop (14px → 20px) | `0ed5f840` |
| 2026-03-23 22:07 | Fix xG with Pythagorean matchup formula, make win% more prominent | `009bfd68` |
| 2026-03-23 21:49 | Derive displayed xG from ML model features, remove Poisson dependency | `f24cd320` |
| 2026-03-23 21:44 | ML model v3: feature pruning (62→22 features), cross-season EWMA carryover, Platt calibration (CV LL: 0.6993→0.6855) | `34b23966` |
| 2026-03-23 21:15 | Switch to ML-only predictions, remove CI/confidence system from backend + frontend | `e1990ae1` |
| 2026-03-23 20:32 | Phase 3D: Bayesian uncertainty / confidence intervals to predictions | `3f64b891` |
| 2026-03-23 17:25 | Remove RAPM O/D columns from Skaters table, keep only RAPM Net | `07dae84a` |
| 2026-03-23 17:08 | Fix RAPM display: Bayesian shrinkage + TOI-weighted team totals | `05a4633e` |
| 2026-03-23 16:55 | Phase 3A: Add RAPM and per-60 rate columns to Skaters and Teams tables | `6c45ef52` |
| 2026-03-23 16:38 | Phase 3A: RAPM player isolation via ridge regression | `6d00f115` |
| 2026-03-23 16:09 | Phase 3B: Per-player shooting talent adjustment | `eaf53038` |
| 2026-03-23 10:53 | Add backtesting pipeline for model validation | `5873d660` |
| 2026-03-23 10:41 | Phase 2B: Multi-season goalie modeling with Bayesian regression | `15a8a025` |
| 2026-03-23 10:15 | Phases 1-2: Strip heuristics + ML game outcome model (XGBoost) | `2596c681` |
