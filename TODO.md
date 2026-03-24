# 🏒 HockeyData — Master To-Do List

> **Last updated:** 2026-03-24

---

## 🎨 1. Visual / UI Tweaks

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 1.1 | **Skater Tab: Rookie font color** — Change rookie skater names to `#D9FF82` | 🟢 Low | ⚡ Small (~30 min) | Pure CSS/conditional styling change |
| 1.2 | **Matchup Card (Mobile): Move total goals pill** — Place right under the "History" text for odds history | 🟡 Medium | ⚡ Small (~1 hr) | Layout reorder in mobile view |
| 1.3 | **Matchup Card: Bet pill color logic** — Green (`#0AFF00`, varying opacity) = +EV% AND projected to win. Amber (`#FFAA00`, varying opacity) = +EV% AND projected to lose | 🟡 Medium | 🔧 Medium (~2-3 hrs) | Need to wire up win% direction into pill color logic |

---

## 🧠 2. Core Model Improvements

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 2.1 | **Phase 2C: Better Overtime Modeling** — Replace 50/50 coin flip with proper OT math (historical home OT win rate ~52-53%, or exponential distribution approach) | 🔴 High | 🔧 Medium (~1 day) | Direct log loss improvement on close games. Every game that goes to OT currently gets a 50/50 split — easy win |
| 2.2 | **Phase 3C: Flurry-Adjusted xG** — Discount 2nd/3rd shots in rapid sequences (≤3s apart). More predictive & repeatable than raw xG | 🟡 Medium | 🔧 Medium (~1-2 days) | Requires PBP data processing changes. Improves underlying xG quality which feeds everything |
| 2.3 | **Validation: Full backtest & calibration** — Calibration curves, rolling log loss windows, comparison vs MoneyPuck/Vegas closing lines | 🔴 High | 🔧 Medium (~1 day) | Backtesting pipeline exists (`5873d660`), needs to be run & analyzed. Critical for knowing where we actually stand |

---

## 🤕 3. Model Concerns / Investigations

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 3.1 | **GSAx calibration issue** — Only 3 teams have negative GSAx. Doesn't align with Natural Stat Trick, HockeyStats, MoneyPuck. Possible xG inflation in our shot model | 🔴 High | 🔍 Investigation (~1-2 days) | Could indicate our xG model is systematically low, making most goalies look "good". Need to compare our xG/shot vs industry benchmarks |
| 3.2 | **History tab correctness tracking** — Currently marks "Correct" based on which team scored more goals. Now win% and xG can disagree. Need to decide: track by win% favorite, xG favorite, or both? | 🟡 Medium | 🔧 Medium (~2-3 hrs) | Recommend switching to win% as primary correctness metric since that's our actual prediction |

---

## 📋 4. Feature Development

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| 4.1 | **Playoffs tab: Magic/Tragic number cleanup** — Hide Tragic Number once clinched; hide Magic Number once eliminated. Fix teams showing >0 numbers despite being officially clinched/eliminated | 🟡 Medium | 🔧 Medium (~3-4 hrs) | Need to cross-reference official clinch/elimination status with calculated numbers |
| 4.2 | **Teams page: Blown Leads & Comeback Wins columns** — 8 new columns: BL, BL(3P), BL(2+), BL(3+), CW, CW(3P), CW(2+), CW(3+) | 🟢 Low | 🔨 Large (~1-2 days) | Requires parsing PBP or game score progression data to determine lead states at various points. Fun feature but not model-impacting |

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
