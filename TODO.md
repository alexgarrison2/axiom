# 🏒 HockeyData — Master To-Do List

> **Last updated:** 2026-03-24 22:30

---

## 🎨 1. Visual / UI Tweaks

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| ~~1.1~~ | ~~Skaters page: Rookies filter button~~ | ✅ Done | — | 🌱 toggle button, lime-green active state, filters by `isRookie: true` from `player_bio.json` |
| ~~1.2~~ | ~~Teams page: Clinch/elimination icons~~ | ✅ Done | — | P/Z/Y/X/E from NHL API (`clinch_status.json`), see section 7 |
| ~~1.3~~ | ~~Teams page: Column group toggles~~ | ✅ Done | — | Multi-select, all-on default, conditional rendering fix, see section 7 |

---

## 🧠 2. Core Model Improvements

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| ~~2.1~~ | ~~Expand training data to 4+ seasons~~ | ✅ Done | — | `build_historical_2223.py`: 1,312 games via NHL API → +114K shots, +2,624 gamestats. Retrained on 4,965 games. Backtest: ML LL 0.6830→0.6811, Blended LL 0.6797, ECE 0.0189→0.0106, Acc 56.6% |
| ~~2.2~~ | ~~Tighten prediction clip range [0.15, 0.85] → [0.25, 0.75]~~ | ✅ Done | — | Updated in `ml_predict.py` line 304, `backtest_model.py` lines 107 + 229 |

---

## 🤕 3. Model Concerns / Investigations

| # | Task | Priority | Effort | Notes |
|---|------|----------|--------|-------|
| ~~3.1~~ | ~~GSAx calibration issue~~ | ✅ Done | — | Root cause: 3 bugs — (1) EN shots got ~0.09 xG instead of ~0.52 (−358 xG), (2) flurry discount [1.0,0.5,0.25,0.15] removed 724 xG but those shots scored 1383 goals, (3) raw model over-predicted first shots by ~9%. Fix: isotonic calibration on XGBoost, EN override to 0.52, removed flurry discount entirely (rebounds score at/above model), added league-wide normalization (total xG = total goals). Result: league GSAx sums to 0.0, 18 pos / 14 neg teams, goalie rankings pass eye test (Sorokin, Thompson top; Binnington, Askarov bottom) |
| ~~3.2~~ | ~~History tab correctness tracking~~ | ✅ Done | — | `HistoryTable.tsx`: renamed column "xG Model"→"Prediction", cell now shows favored team triCode + win% as primary with xG as small secondary. `isCorrect` was already win%-based in `generate_history.py` — display-only fix |
| 3.3 | **Will Borgen / EV Defense investigation** — Will Borgen is appearing as #1 EV Defender by RAPM. Investigate whether this is a data artifact (small sample, teammate effects, xG suppression in limited role) or if it's legitimate | 🟡 Medium | 🔍 Investigation (~1-2 hrs) | Check TOI, zone starts, teammates on ice, and compare to industry RAPM sources |

---

## 📋 4. Feature Development

| # | Task | Priority | Effort | Notes |
| --- | ------ | ---------- | -------- | ------- |
| 4.1 | **Playoffs tab: Magic/Tragic number cleanup** — Hide Tragic Number once clinched; hide Magic Number once eliminated. Fix teams showing >0 numbers despite being officially clinched/eliminated | 🟡 Medium | 🔧 Medium (~3-4 hrs) | Need to cross-reference official clinch/elimination status with calculated numbers |
| 4.2 | **Teams page: Blown Leads & Comeback Wins columns** — 8 new columns: BL, BL(3P), BL(2+), BL(3+), CW, CW(3P), CW(2+), CW(3+) | 🟢 Low | 🔨 Large (~1-2 days) | Requires parsing PBP or game score progression data to determine lead states at various points. Fun feature but not model-impacting |
| ~~4.3~~ | ~~Pipeline: Daily Raw PBP Updater~~ | ✅ Done | — | `update_raw_pbp.py`: incremental append to `raw_pbp_20252026.csv` via NHL API, dedupes by game_id, `--days N` / `--dry-run` args. Hooked into Full Refresh block in `update_data.yml` after `enrich_pbp.py` |

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
| 2026-03-24 18:00 | Phase 4A: 4-season training (2022-26) + clip [0.25,0.75]. ML LL 0.6830→0.6811, Blended LL 0.6797, Blended ECE 0.0189→0.0106, Acc 56.6%. `build_historical_2223.py` | `a4a26809` |
| 2026-03-24 17:30 | Clip range tightened [0.15, 0.85] → [0.25, 0.75] in ml_predict.py + backtest_model.py (3 locations) | `a4a26809` |
| 2026-03-24 17:30 | Skaters page: Rookies filter button (🌱 toggle, lime-green `#D9FF82`, `isRookie` flag from NHL stats API) | `dcd7a553` |
| 2026-03-24 16:30 | Column group toggle fix: conditional rendering (return null) instead of CSS hidden — prevents cell count mismatch / data shift. Official clinch badges (P/Z/Y/X/E) from NHL API via `fetch_clinch_status.py` | `TBD` |
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
