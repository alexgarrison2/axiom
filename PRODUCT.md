# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
NHL bettors/handicappers and hockey fans/analytics readers, equally. Bettors check model price against the market on tonight's games and look for edges. Fans browse team and player xG stats, standings, playoff odds and news. No accounts.

## Product Purpose
pony xG publishes NHL game predictions, team and player analytics, and playoff odds from its own shot-quality (xG) and game-outcome models. Success: users trust the numbers because the model's record is public and checkable.

## Positioning
Public, graded honesty. Pre-game predictions are frozen per day (`public/data/SiteHistory/`) and graded against the de-vigged market on `/accuracy`, misses included; `/methodology` explains the model. A competitor that hides or cherry-picks its record could not truthfully copy this.

## Operating Context
Pipeline (Python, GitHub Actions) runs hourly 12:00-02:00 UTC and commits CSV/JSON to `main`; Next.js 16 App Router on Vercel renders them. No database. Usage peaks on game days around tonight's slate. Early in a season most current-season stats are tiny samples or empty.

## Capabilities and Constraints
- Routes: home (matchups), props, accuracy, teams, players, standings, playoffs, news, methodology, ui-kit.
- Never hardcode a season; use `lib/season.ts`. 2026-27 is an 84-game season.
- Early season: show "no games yet" or label prior-season values explicitly; never present last season as current.
- Data limited to free public sources (NHL API, MoneyPuck with credit, DailyFaceoff, ESPN); Natural Stat Trick, DraftKings direct, PuckPedia unusable.
- Copy is minimal: page headings are the page name only, labels 1-2 uppercase mono words, explanations live on `/methodology`.

## Brand Commitments
Name "pony xG". Existing "Neon Arcade" tokens in `app/globals.css` (cyan brand/active, green positive, magenta model, amber situational, red negative; glow only on live data), IBM Plex Sans Condensed throughout with tabular figures. Team logos big with no padding; no red-yellow-green scales; values sit on their team's side.

## Evidence on Hand
Real graded history in `data/prediction_history.json` and `public/data/model_report.json`. No testimonials or user counts; do not fabricate.

## Product Principles
1. Show the record: accuracy and uncertainty are first-class, never hidden.
2. Honest about small samples; label what is prior-season or thin.
3. Scanability over decoration: numbers align, one glance per game.
4. Model vs market is the core comparison; make it immediate.
5. Explanations live on methodology, not inline.
