"""
Analyze scraped playoff historical data vs regular season baselines
to derive empirical playoff coefficients.

Usage: python3 analyze_playoff_data.py
"""

import pandas as pd
import numpy as np

df = pd.read_csv("playoff_historical.csv")

# Deduplicate to game-level (one row per game, home perspective only)
games = df[df["is_home"] == 1].copy()
# Full df for team-level stats (both perspectives)
all_rows = df.copy()

print("=" * 70)
print(f"NHL PLAYOFF DATA ANALYSIS — {games['season'].nunique()} seasons, {len(games)} games")
print("=" * 70)

# ═══════════════════════════════════════════════════════════════════
# 1. SCORING
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("1. SCORING BY ROUND")
print("=" * 70)

# Regulation goals only (subtract OT goals)
all_rows["goals_reg"] = all_rows["goals_for"] - all_rows["goals_for_OT"]
all_rows["goals_ag_reg"] = all_rows["goals_against"] - all_rows["goals_ag_OT"]

# Total goals per game (home + away, regulation only)
games["total_goals"] = games["goals_for"] + games["goals_against"]
games["total_goals_reg"] = (games["goals_for"] - games["goals_for_OT"]) + (games["goals_against"] - games["goals_ag_OT"])

for rnd in sorted(games["playoff_round"].unique()):
    rnd_games = games[games["playoff_round"] == rnd]
    n = len(rnd_games)
    avg_total = rnd_games["total_goals"].mean()
    avg_total_reg = rnd_games["total_goals_reg"].mean()
    ot_pct = rnd_games["went_to_ot"].mean() * 100
    print(f"  Round {rnd}: {n:3d} games | {avg_total:.2f} goals/game (total) | "
          f"{avg_total_reg:.2f} (reg only) | {ot_pct:.1f}% OT")

overall_avg = games["total_goals"].mean()
overall_reg = games["total_goals_reg"].mean()
overall_ot = games["went_to_ot"].mean() * 100
print(f"  {'TOTAL':>8}: {len(games):3d} games | {overall_avg:.2f} goals/game (total) | "
      f"{overall_reg:.2f} (reg only) | {overall_ot:.1f}% OT")

# Per-team goals (for comparison with reg season ~3.1-3.2 per team)
team_avg = all_rows.groupby("playoff_round")["goals_for"].mean()
print(f"\n  Per-team goals/game by round:")
for rnd in sorted(team_avg.index):
    print(f"    R{rnd}: {team_avg[rnd]:.2f}")
print(f"    ALL: {all_rows['goals_for'].mean():.2f}")

# Regulation-only per team
team_avg_reg = all_rows.groupby("playoff_round")["goals_reg"].mean()
print(f"\n  Per-team goals/game (REG ONLY) by round:")
for rnd in sorted(team_avg_reg.index):
    print(f"    R{rnd}: {team_avg_reg[rnd]:.2f}")
print(f"    ALL: {all_rows['goals_reg'].mean():.2f}")

# ═══════════════════════════════════════════════════════════════════
# 2. SHOTS & HIGH-DANGER CHANCES
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("2. SHOTS & HIGH-DANGER CHANCES")
print("=" * 70)

# SOG per team (reg only: subtract OT SOG)
all_rows["sog_reg"] = all_rows["sog_for"] - all_rows["sog_for_OT"]
all_rows["attempts_reg"] = all_rows["attempts_for"]  # Can't easily split attempts by period

sog_by_round = all_rows.groupby("playoff_round")["sog_for"].mean()
sog_reg_by_round = all_rows.groupby("playoff_round")["sog_reg"].mean()
hd_by_round = all_rows.groupby("playoff_round")["hd_chances_for"].mean()
att_by_round = all_rows.groupby("playoff_round")["attempts_for"].mean()

print(f"  {'Round':<8} {'SOG/team':>10} {'SOG(reg)':>10} {'HD/team':>10} {'Att/team':>10} {'HD%':>8}")
for rnd in sorted(sog_by_round.index):
    sog = sog_by_round[rnd]
    sog_r = sog_reg_by_round[rnd]
    hd = hd_by_round[rnd]
    att = att_by_round[rnd]
    hd_pct = (hd / att * 100) if att > 0 else 0
    print(f"  R{rnd:<7} {sog:>10.1f} {sog_r:>10.1f} {hd:>10.1f} {att:>10.1f} {hd_pct:>7.1f}%")

sog_all = all_rows["sog_for"].mean()
sog_reg_all = all_rows["sog_reg"].mean()
hd_all = all_rows["hd_chances_for"].mean()
att_all = all_rows["attempts_for"].mean()
print(f"  {'ALL':<8} {sog_all:>10.1f} {sog_reg_all:>10.1f} {hd_all:>10.1f} {att_all:>10.1f} {(hd_all/att_all*100):>7.1f}%")

# Shooting percentage
all_rows["sh_pct"] = all_rows["goals_for"] / all_rows["sog_for"].replace(0, np.nan)
sh_by_round = all_rows.groupby("playoff_round")["sh_pct"].mean()
print(f"\n  Shooting % by round:")
for rnd in sorted(sh_by_round.index):
    print(f"    R{rnd}: {sh_by_round[rnd]*100:.1f}%")
print(f"    ALL: {all_rows['sh_pct'].mean()*100:.1f}%")

# ═══════════════════════════════════════════════════════════════════
# 3. SAVE PERCENTAGE
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("3. SAVE PERCENTAGE")
print("=" * 70)

sv_by_round = all_rows.groupby("playoff_round")["save_pct"].mean()
for rnd in sorted(sv_by_round.index):
    print(f"  R{rnd}: {sv_by_round[rnd]:.4f}")
print(f"  ALL: {all_rows['save_pct'].mean():.4f}")

# ═══════════════════════════════════════════════════════════════════
# 4. SPECIAL TEAMS
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("4. SPECIAL TEAMS")
print("=" * 70)

pp_opps_by_round = all_rows.groupby("playoff_round")["pp_opportunities"].mean()
pp_goals_by_round = all_rows.groupby("playoff_round")["pp_goals_for"].mean()

print(f"  {'Round':<8} {'PP Opps':>10} {'PP Goals':>10} {'PP%':>10}")
for rnd in sorted(pp_opps_by_round.index):
    opps = pp_opps_by_round[rnd]
    goals = pp_goals_by_round[rnd]
    pct = (goals / opps * 100) if opps > 0 else 0
    print(f"  R{rnd:<7} {opps:>10.2f} {goals:>10.2f} {pct:>9.1f}%")

opps_all = all_rows["pp_opportunities"].mean()
goals_all = all_rows["pp_goals_for"].mean()
print(f"  {'ALL':<8} {opps_all:>10.2f} {goals_all:>10.2f} {(goals_all/opps_all*100):>9.1f}%")

# Penalties per team per game (= opponent's PP opportunities)
pen_per_game = all_rows.groupby("playoff_round")["pk_opportunities"].mean()
print(f"\n  Penalties taken per team per game:")
for rnd in sorted(pen_per_game.index):
    print(f"    R{rnd}: {pen_per_game[rnd]:.2f}")
print(f"    ALL: {all_rows['pk_opportunities'].mean():.2f}")

# ═══════════════════════════════════════════════════════════════════
# 5. HOME ICE ADVANTAGE
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("5. HOME ICE ADVANTAGE")
print("=" * 70)

home_wins = games.groupby("playoff_round").agg(
    wins=("won", "sum"),   # Home perspective: "won" column from home row is 1 if home won
    total=("won", "count")
).reset_index()
# Actually, "won" in the home row = did home team win?
# Wait — "won" was set based on goals_for > goals_against, where goals_for is HOME goals
# So yes, games["won"] == 1 means home team won

print(f"  {'Round':<8} {'Home Wins':>12} {'Total':>8} {'Home Win%':>10}")
for _, row in home_wins.iterrows():
    pct = row["wins"] / row["total"] * 100
    print(f"  R{int(row['playoff_round']):<7} {int(row['wins']):>12} {int(row['total']):>8} {pct:>9.1f}%")

total_hw = games["won"].sum()
total_g = len(games)
print(f"  {'ALL':<8} {int(total_hw):>12} {int(total_g):>8} {total_hw/total_g*100:>9.1f}%")

# ═══════════════════════════════════════════════════════════════════
# 6. OVERTIME
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("6. OVERTIME")
print("=" * 70)

ot_games = games[games["went_to_ot"] == 1]
print(f"  OT games: {len(ot_games)} / {len(games)} ({len(ot_games)/len(games)*100:.1f}%)")

# Home win rate in OT
ot_home_wins = ot_games["won"].sum()  # "won" from home perspective = home won
print(f"  Home wins in OT: {int(ot_home_wins)} / {len(ot_games)} ({ot_home_wins/len(ot_games)*100:.1f}%)")

# Multi-OT frequency
multi_ot = games[games["ot_periods"] > 1]
print(f"  Multi-OT games: {len(multi_ot)} / {len(games)} ({len(multi_ot)/len(games)*100:.1f}%)")

ot_period_dist = games[games["ot_periods"] > 0]["ot_periods"].value_counts().sort_index()
print(f"  OT period distribution:")
for periods, count in ot_period_dist.items():
    print(f"    {int(periods)} OT: {count} games")

# OT by round
ot_by_round = games.groupby("playoff_round")["went_to_ot"].mean()
print(f"\n  OT frequency by round:")
for rnd in sorted(ot_by_round.index):
    print(f"    R{rnd}: {ot_by_round[rnd]*100:.1f}%")

# ═══════════════════════════════════════════════════════════════════
# 7. PHYSICALITY
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("7. PHYSICALITY")
print("=" * 70)

hits_by_round = all_rows.groupby("playoff_round")["hits_for"].mean()
blocks_by_round = all_rows.groupby("playoff_round")["blocks_for"].mean()
give_by_round = all_rows.groupby("playoff_round")["giveaways"].mean()
take_by_round = all_rows.groupby("playoff_round")["takeaways"].mean()

print(f"  {'Round':<8} {'Hits/team':>12} {'Blocks/team':>12} {'Give':>8} {'Take':>8}")
for rnd in sorted(hits_by_round.index):
    print(f"  R{rnd:<7} {hits_by_round[rnd]:>12.1f} {blocks_by_round[rnd]:>12.1f} "
          f"{give_by_round[rnd]:>8.1f} {take_by_round[rnd]:>8.1f}")
print(f"  {'ALL':<8} {all_rows['hits_for'].mean():>12.1f} {all_rows['blocks_for'].mean():>12.1f} "
      f"{all_rows['giveaways'].mean():>8.1f} {all_rows['takeaways'].mean():>8.1f}")

# ═══════════════════════════════════════════════════════════════════
# 8. PERIOD-BY-PERIOD SCORING PATTERNS
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("8. PERIOD-BY-PERIOD SCORING (per team)")
print("=" * 70)

for period in ["1P", "2P", "3P"]:
    avg = all_rows[f"goals_for_{period}"].mean()
    print(f"  {period}: {avg:.2f} goals/team")

# ═══════════════════════════════════════════════════════════════════
# 9. SEASON-BY-SEASON CONSISTENCY CHECK
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("9. SEASON-BY-SEASON BREAKDOWN")
print("=" * 70)

season_stats = games.groupby("season").agg(
    n_games=("game_id", "count"),
    avg_goals=("total_goals", "mean"),
    avg_goals_reg=("total_goals_reg", "mean"),
    ot_pct=("went_to_ot", "mean"),
    home_win_pct=("won", "mean"),
).reset_index()

print(f"  {'Season':<12} {'Games':>6} {'Goals':>8} {'Goals(reg)':>12} {'OT%':>8} {'Home%':>8}")
for _, row in season_stats.iterrows():
    print(f"  {int(row['season']):<12} {int(row['n_games']):>6} {row['avg_goals']:>8.2f} "
          f"{row['avg_goals_reg']:>12.2f} {row['ot_pct']*100:>7.1f}% {row['home_win_pct']*100:>7.1f}%")

# By season: PP opps, save%, hits
season_team = all_rows.groupby("season").agg(
    pp_opps=("pp_opportunities", "mean"),
    sv_pct=("save_pct", "mean"),
    hits=("hits_for", "mean"),
    hd_chances=("hd_chances_for", "mean"),
    sog=("sog_for", "mean"),
).reset_index()

print(f"\n  {'Season':<12} {'PP Opps':>8} {'SV%':>8} {'Hits':>8} {'HD':>6} {'SOG':>6}")
for _, row in season_team.iterrows():
    print(f"  {int(row['season']):<12} {row['pp_opps']:>8.2f} {row['sv_pct']:>8.4f} "
          f"{row['hits']:>8.1f} {row['hd_chances']:>6.1f} {row['sog']:>6.1f}")

# ═══════════════════════════════════════════════════════════════════
# 10. DERIVED COEFFICIENTS
# ═══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("10. DERIVED COEFFICIENTS FOR PLAYOFF MODEL")
print("=" * 70)

# Regular season baselines (2024-25 approximate)
REG_GOALS_PER_TEAM = 3.12  # approximate league avg
REG_SV_PCT = 0.905
REG_PP_OPPS = 3.05
REG_PP_PCT = 0.215
REG_HITS = 23.0
REG_HOME_WIN = 0.544

playoff_goals = all_rows["goals_reg"].mean()
playoff_sv = all_rows["save_pct"].mean()
playoff_pp_opps = all_rows["pp_opportunities"].mean()
playoff_pp_goals = all_rows["pp_goals_for"].mean()
playoff_pp_pct = playoff_pp_goals / playoff_pp_opps if playoff_pp_opps > 0 else 0
playoff_hits = all_rows["hits_for"].mean()
playoff_home_win = games["won"].mean()

print(f"\n  {'Metric':<25} {'Reg Season':>12} {'Playoffs':>12} {'Delta':>10} {'Ratio':>8}")
print(f"  {'-'*25} {'-'*12} {'-'*12} {'-'*10} {'-'*8}")

def print_comp(name, reg, playoff):
    delta = playoff - reg
    ratio = playoff / reg if reg != 0 else 0
    print(f"  {name:<25} {reg:>12.3f} {playoff:>12.3f} {delta:>+10.3f} {ratio:>8.3f}")

print_comp("Goals/team (reg only)", REG_GOALS_PER_TEAM, playoff_goals)
print_comp("Save %", REG_SV_PCT, playoff_sv)
print_comp("PP Opps/game", REG_PP_OPPS, playoff_pp_opps)
print_comp("PP %", REG_PP_PCT, playoff_pp_pct)
print_comp("Hits/team", REG_HITS, playoff_hits)
print_comp("Home Win %", REG_HOME_WIN, playoff_home_win)

# Round-specific scoring decay
print(f"\n  Scoring decay by round (goals/team, reg only):")
for rnd in sorted(team_avg_reg.index):
    delta = team_avg_reg[rnd] - REG_GOALS_PER_TEAM
    print(f"    R{rnd}: {team_avg_reg[rnd]:.2f} (Δ {delta:+.2f} vs reg season)")

print("\n" + "=" * 70)
print("ANALYSIS COMPLETE")
print("=" * 70)
