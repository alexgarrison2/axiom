# 🏒 HockeyData — Master To-Do List

> **Last updated:** 2026-03-24

---

## 🎨 1. Pure Visual Tweaks

- [ ] Skater Tab: Can we change the font color of Rookie skaters to #D9FF82

- [ ] Matchup Card (Mobile View): Move the pill that shows the Total predicted goals more towards the top. Place it right under the "History" text for odds history.

- [ ] Matchup Card: Change the pill color for recommended bets. Right now it's either green or grey. I want it:
    -Green (different opacities of #0AFF00) = +EV% AND projected to win
    -Different opacities of #FFAA00 = +EV% AND projected to lose

---

## 🧠 2A. Core Model Changes

- [ ]Phase 2B: Improve Goalie Modeling — multi-season GSAx, Bayesian regression by GP
- [ ]Phase 2C: Better Overtime Modeling — replace 50/50 coin flip with proper OT math
- [ ]Phase 3C: Flurry-Adjusted xG — discount rapid-sequence shots
- [ ]Phase 3D: Bayesian Uncertainty — posterior distributions instead of point estimates
- [ ] Validation — backtest, calibration curves, comparison vs MoneyPuck/Vegas lines

---

## 🤕 2B. Core Model Concerns/Questions

- [ ] We only have three teams currently with a negative GSAx. How is that possible? Especially in a year where I'm pretty sure goalie SV% is down across the board. It makes me feel like our model might be inflating xG. Perhaps we need more data to train the model on? I'm not sure. Our GSAx doesn't seem to align with other sites. Directionally it seems to be okay, but the raw numbers are way different from sites like Natural Stat Trick, HockeyStats.com and MoneyPuck.

- [ ] How are we going to track History now? Currently on the History tab, we mark a predicted game as "Correct" if the team we predicted to score more goals actually scored more goals. But now we have games where a team has a higher predicted win %, but lower predicted xG.  

---

## 📋 3. General To Do

- [ ] Playoffs tab: Playoff "Tragic Number" can go away once a team has clinched a playoff spot. Vice Versa for "Magic Number" for eliminated teams.
  - Also, there are teams that are either eliminated officially/clinched officially with a >0 tragic/magic number. We need those to be tightened up.

- [ ] Teams page: Can we add columns for:
  - Blown Leads: Led at one point in the game and did not win
  - Blown Leads (3P): Led at the end of the 2nd period and did not win
  - Blown Leads (2+): Led by 2+ goals at any point in the game and did not win
  - Blown Leads (3+): Led by 3+ goals at any point in the game and did not win
  - Comeback Wins: Trailed at one point in the game and won
  - Comeback Wins (3P): Trailed at the end of the 2nd period and won
  - Comeback Wins (2+): Trailed by 2+ goals at any point in the game and won
  - Comeback Wins (3+): Trailed by 3+ goals at any point in the game and won

---

## 🚀 4. Long-Term Plans/Exploration

- [ ] I'd like a page developed for Goalies that is basically the goalie-equivalent to the Skaters tab.

---

## 📝 5. Other Notes

-

---

## ✅ 6. Completed

- [x]
