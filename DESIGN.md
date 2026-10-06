---
name: pony xG
description: NHL predictions and xG analytics, model price against the market on a near-black scoreboard.
colors:
  bg: "#05070b"
  surface-1: "#0a0e15"
  surface-2: "#0f1622"
  surface-3: "#101a29"
  well: "#070a10"
  track: "#0c121c"
  panel-top: "#0b1019"
  panel-bottom: "#070a10"
  line: "#152031"
  line-strong: "#23405f"
  ink: "#e8eef8"
  text-2: "#8e99ad"
  text-3: "#7a869b"
  mute: "#3b475c"
  brand-cyan: "#29e7ff"
  brand-ink: "#05070b"
  pos-green: "#3dff8f"
  neg-red: "#ff5470"
  model-magenta: "#ff4fd8"
  warn-amber: "#ffc53d"
  goalie-blue: "#4d9fff"
  info-ice: "#9fb0c8"
  pk-orange: "#ff8a3d"
typography:
  display:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "22px"
    letterSpacing: "0.04em"
  title:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "20px"
  body:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "19px"
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  caption:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "17px"
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  label:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "15px"
    letterSpacing: "0.16em"
  pct:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "32px"
  score:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "72px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
rounded:
  chip: "4px"
  control: "8px"
  segmented: "10px"
  bar: "12px"
  card: "16px"
  full: "9999px"
spacing:
  card-phone: "14px"
  card: "16px"
  cell: "8px"
  gutter-phone: "16px"
  gutter: "24px"
  appbar: "56px"
  tabbar: "56px"
components:
  button-primary:
    backgroundColor: "{colors.brand-cyan}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  segmented:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.segmented}"
    padding: "3px"
  segmented-option:
    textColor: "{colors.text-3}"
    typography: "{typography.label}"
    rounded: "7px"
    padding: "0 12px"
    height: "32px"
  segmented-option-selected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.brand-cyan}"
  filter-chip:
    textColor: "{colors.text-3}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 14px"
    height: "34px"
  filter-chip-selected:
    textColor: "{colors.brand-cyan}"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  stat-chip:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
    height: "24px"
  table-header-cell:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-3}"
    typography: "{typography.label}"
    padding: "0 8px"
    height: "32px"
  table-cell:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-2}"
    padding: "0 8px"
    height: "32px"
  hit-rate-cell:
    textColor: "{colors.text-2}"
    rounded: "{rounded.chip}"
    width: "44px"
    height: "32px"
  edge-chip:
    textColor: "{colors.pos-green}"
    rounded: "{rounded.chip}"
    padding: "2px 4px"
  edge-chip-strong:
    backgroundColor: "rgba(61, 255, 143, 0.10)"
    textColor: "{colors.pos-green}"
  situational-tag:
    textColor: "{colors.warn-amber}"
    rounded: "{rounded.chip}"
    padding: "0 4px"
---

# Design System: pony xG

## Overview

**Creative North Star: "Neon Arcade"**

A rink-side scoreboard after dark. Near-black panels sit on a faint 48px grid under a soft cyan top glow; numbers are the content, set in one narrow face with tabular figures so every column lines up. Colour is signal, never decoration: each neon hue owns one meaning (cyan is active and hit, green and red are edge sign, magenta is the model's own number, amber is situational context), and light only blooms around data that is live right now.

The system is dense and scan-first. Tables run 32px rows with sticky headers and a sticky first column; controls are compact uppercase segmented groups and pill chips; cards are flat gradient panels with a 1px hairline. Copy is minimal by rule: a page heading is the page name only, labels are one or two uppercase words, and explanations live on `/methodology`, not inline.

Honesty about samples is visual, not verbal. Prior-season and thin-sample values are dimmed, dashed, or tagged with a small season tag ("25-26"), so last season's number never reads as tonight's. Team identity arrives through big, unpadded crests and a soft team-colour wash on each side, with values placed on their team's side.

**Key Characteristics:**
- Dark only (`color-scheme: dark`); depth by tonal layering and hairlines, not shadows.
- One family, IBM Plex Sans Condensed, 400-700, tabular lining figures on body.
- One meaning per hue; single-hue intensity for magnitude, never a red-yellow-green ramp.
- Glow is reserved for live data: active control, confirmed goalie, live dot, model lean, strong positive edge.
- Uppercase letter-spaced labels; page name only as heading; no eyebrows or taglines.
- Prior-season data dimmed and tagged, never styled as current.

## Colors

A near-black ink field with five saturated neons, each bound to exactly one job.

### Primary
- **Arcade Cyan** (brand-cyan): Brand, active and focus. The selected segment's text, the selected filter chip's edge glow, the 2px focus ring, sort indicators, the PP1 chip, and on `/props` a game that cleared the line (lit tape bar, hit-rate wash). Solid cyan fill is reserved for the single primary button, with near-black text (brand-ink) on it. On `/games/[id]` cyan in the data is the reader's stop: the stepped event's flag, the selected pin ring, shot mark and goal card edge; it also marks the active section in the contents rail.

### Secondary
- **Goal-Light Green** (pos-green): Positive. Plus edges, confirmed goalies, model-correct grades, the live dot.
- **Siren Red** (neg-red): Negative. Minus edges, destructive actions, model misses.
- **Model Magenta** (model-magenta): The model's own number. Raw model marker, model lean, and on `/props` the pony xG fair percentage and unposted fair prices. On `/games/[id]`: the win-probability line and readout, the pregame call percentage, and every pony xG value (xG, xGF, xGA, ixG). Also the playoff token.

### Tertiary
- **Situational Amber** (warn-amber): Context that changes tonight's read, not a judgement. Back-to-back and other situational chips, a promoted lineup unit (amber edge + up arrow), a linemate boost ("w/ Name"), a top-8 soft matchup rank, the small-sample `n=` tag, rookie marks. On `/games/[id]`: the power-play window's 2px cap and "PP" tag on the pulse, and goal chips for PP, SH, EN and an extra attacker ("6v5").
- **Goalie Blue** (goalie-blue): Starting-goalie status only, kept distinct from cyan and green.
- **Penalty-Kill Orange** (pk-orange): Penalty kill in special-teams dots and the PK segment of minutes bars; power-play minutes use cyan (the `--pp` token).
- **Ice Grey** (info-ice): Neutral information that must never read as neon; defensive-zone starts on the zone-start bars.

### Neutral
- **Rink Black** (bg): Page field; also the opaque strip behind sticky table headers and control bars (at 95% with backdrop blur for bars).
- **Panel** (surface-1): Card and table body surface; the panel gradient runs panel-top to panel-bottom.
- **Inset** (surface-2) and **Raised** (surface-3): Tracks and insets; the selected segment fill.
- **Well** (well): Segmented and tab containers. **Track** (track): empty win-bar track.
- **Hairline** (line) and **Hover Edge** (line-strong): Every border, divider and zebra mix; line-strong on hover and on input edges.
- **Ink** (ink): Data, names, headings. **Secondary** (text-2): secondary values. **Dim** (text-3): labels, AA on every surface. **Mute** (mute): separators, decoration, missed-game bars; never data text.

### Team Sides
Each side of a game carries its club colour, resolved per game rather than per team. The site-wide pair is clash-checked (primary vs primary, then alternates); the game page tightens it: a side that sits within deltaE 25 of penalty-kill orange moves to its alternate colour, and a pair still closer than deltaE 45 moves whichever side gains the most separation to its alternate. Side colour fills bars, pins, rings, lane labels and split cells; it never carries a state.

### Named Rules
**The Clash-Safe Side Rule.** On a game surface, side colours come only from the game's resolved pair, never from a raw team primary, so split cells and dimmed bars stay tellable apart and no side reads as the penalty kill.

**The Owner-Colour Rule.** A game state either side can own (a power-play or extra-attacker window) takes the colour of the side that owns it at that moment, so whose advantage it is reads at a glance: a solid side-colour block with the real counts ("DAL 5v4", "6v5"), a faint side-colour band, and a side-colour hatch over that side's half of the bars. States nobody owns (4v4, 3v3) stay neutral grey. Amber marks the cause (a penalty tick), never the state. Text on a block picks dark or light ink by contrast; side-colour text on the panel is lifted toward white until it reaches 4.5:1.

**The One Meaning Rule.** Each neon owns one job: cyan active/hit, green positive, red negative, magenta model, amber situational, blue goalie. Never borrow a hue for decoration or for a second meaning.

**The Single-Hue Intensity Rule.** Magnitude is shown as the strength of one hue, never as a traffic light. Hit-rate cells are a cyan wash whose alpha is the rate (0.04 + 0.34 x rate); samples under 5 games get no wash and dim text.

**The Live Glow Rule.** Glow appears only on live data: the active control, confirmed goalie, live dot, favourite's bar segment, model lean, and an edge of +5.0 or more. Everything else is flat.

## Typography

**Display Font:** IBM Plex Sans Condensed (with Arial Narrow, system-ui)
**Body Font:** IBM Plex Sans Condensed
**Label/Mono Font:** IBM Plex Sans Condensed (`font-mono` and `font-display` are aliases of the one family)

**Character:** One narrow grotesque doing every job. Condensed letterforms let dense tables breathe; tabular lining figures (on body) keep number columns aligned without a monospace face. Hierarchy comes from weight, case and tracking, not from a second family.

### Hierarchy
- **Display** (700, 24px phone / 30px md, line-height 1, uppercase): The page heading, page name only, one per page.
- **Headline** (700, 18px/22px, 0.04em, uppercase): Section H2.
- **Title** (700, 16px/20px): Card titles, player names in detail views.
- **Body** (400, 14px/19px, tabular): Default page text. Table cells run 12-13px in the same face.
- **Caption** (400, 13px/17px): Controls at md+, detail tables, inputs at md+.
- **Label** (500, 12px/15px, 0.16em, uppercase, dim): The 1-2 word label. Table headers use 0.06em; segmented options 0.12em. 12px (`micro`) is the floor.
- **Pct** (700 italic, display sizes): Bold italic win percentage; scoreboard numbers are bold with -0.02em tracking.
- **Score** (700, 44px phone / 72px md, line-height 1, tabular): The game score on `/games/[id]`, one per side. In a final the loser's score dims to the dim text colour.

### Named Rules
**The 12px Floor Rule.** Nothing is smaller than 12px; legacy smaller sizes are lifted to 12px in the stylesheet and flagged by lint.

**The One Big Number Rule.** The ramp tops out at display; the only step above it is the game score, the dominant number of its page. Nothing else borrows that size.

**The Page Name Rule.** A page heading is the page name, nothing else: no eyebrow, no tagline, no subtitle. The heading component accepts but does not render eyebrow and description props.

## Layout

One content edge for nav, pages and footer: 1400px max width, 16px gutters on phones, 24px from 768px. Pages add only vertical rhythm (16px gaps between page blocks are typical). The app bar is 52px on phones and 56px from md; below md a fixed 56px bottom tab bar takes over navigation, and scroll padding keeps focus clear of both bars.

Data pages stack: heading row (title left, compact controls right) then a sticky control bar, then a meta line, then the table. The control bar pins under the app bar, bleeds to the page edge, and sits on 95% rink black with backdrop blur and a hairline under it; it holds the primary segmented control, a secondary segmented control, search (right-aligned at md), and a horizontally scrolling chip row on phones that wraps at md.

Tables scroll inside their own region with edge fades; the first column is sticky with a right-edge shadow; the header row is sticky. On `/props` the column header pins beneath the sticky control bar from xl (1280px) by tracking the bar's measured height; below xl the table scrolls in its region. Default rows are 32px; `/props` rows are 44px so the 32px tape fits. Columns that are secondary drop out below xl or md rather than shrinking. Matchup cards lay out by their own width with container queries.

The game page (`/games/[id]`) is one long read in a fixed order, every game: score band full width, then Story (the pulse), Goals, Shots, Team stats, Skaters, Goalies, Lines, Matchups, Zone starts, 40px apart. From lg (1024px) a 136px sticky contents rail sits left of the sections (a hairline left edge; the active item takes a 2px cyan left bar and cyan text). Below lg the rail becomes a chip bar pinned under the app bar, bled to the page edge on 95% rink black with backdrop blur and a hairline under it, scrolling sideways. Section headings anchor with scroll margin clear of the bar. Away is always left and home right; mirrored rows grow outward from a centre label.

Touch targets grow to 44px on coarse pointers across chips, segments and buttons.

## Elevation & Depth

Flat by default. Depth is tonal: rink black field, gradient panels (panel-top to panel-bottom) with a 1px hairline, inset wells for control groups, and zebra rows mixed from the hairline colour into the panel colour so sticky cells stay opaque. Card shadow is explicitly none. The only shadows are glows bound to live state, plus one structural shadow: the sticky first column's soft right-edge shadow that separates it from scrolled cells.

### Shadow Vocabulary
- **Brand glow** (`box-shadow: 0 0 16px rgba(41,231,255,0.18), inset 0 0 12px rgba(41,231,255,0.12)`): Selected filter chip and active control.
- **Strong edge glow** (`box-shadow: 0 0 12px rgba(61,255,143,0.25)` on a 10% green fill): Edge chip at +5.0 or higher.
- **Text glows** (`text-shadow: 0 0 10-12px` of the hue at 0.45-0.5): Live green, goalie blue, model magenta, cyan values.
- **Sticky column edge** (`box-shadow: 4px 0 8px -6px rgba(0,0,0,0.8)`): Structural, sticky first column only.

### Named Rules
**The Flat-At-Rest Rule.** Panels never cast shadows. A hover brightens the hairline to line-strong; it does not lift.

## Shapes

A tight radius ladder by role: 4px chips and tags, 7px segment options inside a 10px well, 8px controls and inputs, 10px inset tiles, 12px bars, 16px cards and table regions, full pills for filter chips and dots. Borders are 1px hairlines everywhere; dashed borders mean a thin or prior-season sample (amber-tinted dashed for small samples, mute dashed for prior season). Win bars carry a fine 115-degree diagonal hatch over each fill. Micro-chart bars use 1px corners (2px at detail size).

## Components

### Buttons
Compact, uppercase, letter-spaced; solid colour is rare.
- **Shape:** Gently squared (8px), 36px tall (32px small, 44px large and on touch).
- **Primary:** Solid cyan with rink-black text, bold uppercase caption; only for the one primary action. Hover brightens 10%.
- **Outline / Secondary / Ghost:** Hairline outline in ink (hover edge brightens); raised fill whose text turns cyan on hover; dim text that brightens to ink.
- **Destructive:** Red text with a half-strength red edge, 10% red fill on hover.

### Segmented control
The site's one view switcher (views, seasons, categories, lines). A radiogroup in a 10px well with a hairline and 3px inset; options are 7px-rounded uppercase labels at 0.12em, 32px tall (28px small). Selected = raised fill with cyan text; unselected dim, brightening on hover. Arrow keys move and select.

### Chips
- **Filter chip:** Full pill, 34px tall, hairline edge, dim uppercase label. Selected = cyan text, 60% cyan edge, brand glow. Optional bold count after the label; game chips lead with two 24px crests. Unpriced games sit at 60% opacity.
- **Stat chip:** 4px label + value chip. Current = hairline; small sample = amber-tinted dashed edge with an amber `n=` tag; prior season = mute dashed edge, secondary value, and a season tag.
- **Situational tag:** Amber-edged lineup unit with a promotion arrow; amber text for a linemate boost or soft-matchup rank. PP1 is cyan-edged; other units are hairline and dim.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Panel gradient; optional team-colour radial wash at 22% behind each side.
- **Shadow Strategy:** None (see Elevation).
- **Border:** 1px hairline; line-strong on hover when interactive.
- **Internal Padding:** 14px phone, 16px md+.

### Inputs / Fields
Panel fill, 1px hairline (hover edge on hover), 8px radius, 36px tall, caption text at md, dim placeholder with label tracking. Focus is the global 2px cyan ring at 2px offset.

### Navigation
Top app bar on md+ and a fixed bottom tab bar below md; active item cyan with glow, others dim. Focus everywhere is the single 2px cyan outline.

### Dense table
Rink-black sticky header (32px, uppercase dim labels at 0.06em, hairline under). Body cells on the panel colour with opaque zebra (40% hairline mix) and hover (85% mix); sticky first column with crest, name (cyan on row hover), and a dim meta line. Sort headers put the indicator in cyan. Missing values are an em dash in the disabled colour.

### Hit Tape (signature, `/props`)
A per-game bar micro-chart, oldest to newest, one bar per game against the line. Bars that cleared the line are solid cyan; misses are mute; zero games are a 2px stub in the hover-edge colour. Last season's games sit at 50% opacity behind a 1px dim seam. The line is a solid ink hairline at 70% that slides to the new threshold (200ms ease-out) while the bars re-light; reduced motion disables both. Sizes: row (6px bars, 2px gap, 32px tall), compact (4px bars), detail (20px bars, 7px gaps, 84px plot, value above and opponent below each bar). A legend of three swatches (over, under, prior season) sits in the meta line.

### Hit-rate cell (`/props`)
A 44px (48px md) by 32px chip centred in the cell: rate on top, `hits/n` in micro dim below, on a cyan wash whose alpha follows the rate. Rates of 60%+ go semibold ink; under 5 games the wash drops and text dims.

### Edge chip (`/props`)
Right-aligned signed value in tenths ("+6.2"), green above zero, red below, secondary at zero. At +5.0 or more it gains a 10% green fill and the strong edge glow. Fair percentage beside it is magenta.

### Score band (`/games/[id]`)
A full-width panel: away crest and score left, home mirrored right, a centre column with the status chip (live: green text on a 10% green fill with the live glow; final: raised fill, ink text), date, a goals-by-period line score with SOG, and venue. Crests run flush at 56px phone / 112px md. Under each score a 4px by 40px rounded bar in the side colour (40% for a final's loser). A hairline-topped strip below holds the pregame call (pick, magenta probability, dim market and price, green Hit / red Miss once final) and the three stars.

### Pulse strip (signature, `/games/[id]`)
The game on one 60-minute axis (longer for overtime, one seam per OT period), lanes top to bottom:
- **Goal pins:** the scoring side's crest, as large as the disc allows, in a 19px-radius disc (13px under 640px wide) on the inset fill with a 2px side-colour ring; the goal's xG in magenta under the pin when no pin hangs below. Colliding pins stack into up to three rows 1.55 radii apart. A side-colour hairline at 55% drops from each pin through every lane. Pins are focusable buttons named with clock, team, scorer, xG and the win swing.
- **Win lane:** home win probability on a scale that is linear through the middle and stretched near 0 and 100% (so blowouts keep moving). Solid 2px magenta = the score-and-clock model, starting at the frozen pregame call (a magenta dot at puck drop); dashed 1.25px magenta = deserved win % from the shots' xG so far. A 2px ink tick marks the de-vigged market at puck drop; "PONY TRI 63% · MKT TRI 58%" rides the lane's top row. The leader's half is tinted in that side's colour at 20%; home owns the top half. End values right: the score line's % and "xG %" for the dashed line.
- **Strength row ("STR"):** owner-colour blocks per the Owner-Colour Rule; amber 2px ticks where penalties were called.
- **Bars lane:** one bar per minute in side colour at 85%, home above the axis, away below; metric switchable (attempts, unblocked, SOG, xG) with the lane maximum printed under the label. "Share" swaps the bars for a rolling five-minute xG share around 50% (side-colour fills at 50%, ink line). High-danger chances (xG ≥ 0.20) that did not score are 2.75px side-colour dots on the shooting side's edge.
- **Race lane:** running totals as 2px side-colour step lines, end values right; for xG and goals, dashed side-colour pace lines rise to each side's pregame projection at 60:00.
- **Seams and axis:** 1px hover-edge period seams through all lanes; dim period labels under the axis (1st, 2nd, 3rd, OT, 2OT…).
- **Moments:** a mouse hover draws an ink playhead at 40%; a click, a tap or drag (touch scrubs horizontally, vertical drags scroll), Shift+Left/Right (one minute) or Home/End holds a moment as a dashed ink line, mirrored to `?t=` so a moment can be shared. Left/Right and the arrow buttons step through goals and penalties (Escape clears); the stop is a 1.5px cyan line with a cyan flag and a cyan pin ring. A playhead chip (16px card, 95% panel with blur) follows the moment and flips past 58% of the width: clock, then away crest, score and race value | metric | home value, score and crest, then the leader's win % and the deserved leader's xG %.
- **Verdict row:** at rest the row under the chart reads how it ended: Result, Call (with a drawn check or cross), Market, xG totals and the deserved %, the biggest Swing, and a Method link to `/methodology#game-story`.
- **On ice:** always present under the verdict, at the final horn (or the live moment) until a moment is chosen; away first, then home.
Lanes run 120 / 136 / 110px tall (84 / 96 / 72px compact) with 18px between them; the strength row is 20px (16px compact). Metric choices persist per browser.

### Goals spine (`/games/[id]`)
A 1px hover-edge spine down the centre from md; away goal cards sit in the left half, home cards mirrored in the right, each with an 8px side-colour dot on the spine. Period chips (4px, rink black, hairline) sit on the spine. A goal card is a 16px panel with a hairline (cyan when it is the stop): 56px (64px md) headshot ring in side colour, scorer and running count, amber situational chips, assists, magenta xG, a cyan Clip link, and on the far side the score after, clock, and the win swing to tenths in green or red with the post-goal win % in magenta. Penalties join on demand (a filter chip) as dashed-hairline rows with the team in amber. Below md the spine drops and cards stack.

### Game data marks (`/games/[id]`)
- **Team stats rows:** mirrored 20px bars on the track, 3px corners, growing away from the centre label in side colour (90% for the leader, 35% otherwise); xG rows' values in magenta.
- **Minutes bars:** 12px, 2px corners, length by time on ice; segments EV (secondary text colour), PP (`--pp` cyan), PK (`--pk` orange).
- **Zone-start bars:** 16px diverging bars: defensive-zone starts left in ice grey, neutral and on-the-fly centre in mute, offensive-zone starts right in side colour; each splits into three intensity steps by period (40%, 68%, 100%, later periods darker).
- **Matchup grid:** 5v5 time between every away and home skater as squares sized by the square root of time (cells 22-44px), each split area-true along the diagonal by xG share, away colour from the upper-left corner over the home colour; no xG shows mute, under 5 seconds a 2px hover-edge dot.
- **Shot map:** marks in side colour sized by xG (goals solid with an ink ring, saved 50%, misses outlined, blocks as crosses); the stop gains a cyan ring.

## Do's and Don'ts

### Do:
- **Do** bind every neon to its one meaning: cyan active/hit, green positive, red negative, magenta model (fair %), amber situational (promoted line, linemate boost, soft matchup, small sample), blue goalie.
- **Do** show magnitude as single-hue intensity (cyan wash alpha 0.04 + 0.34 x rate).
- **Do** dim and tag prior-season values (50% opacity, mute dashed edge, "25-26" season tag) and mark samples under 5 games.
- **Do** keep table headers and control bars on opaque rink black (95% plus blur for bars) with a hairline beneath, and zebra by mixing the hairline into the panel colour.
- **Do** use big team crests with no padding, and place values on their team's side.
- **Do** keep labels to 1-2 uppercase words and the page heading to the page name.
- **Do** honour reduced motion; transitions are 200ms ease-out, transform and fill only.
- **Do** take side colours from the game's resolved pair on any game surface, and keep away left, home right.

### Don't:
- **Don't** use red-yellow-green scales or any traffic-light ramp for magnitude.
- **Don't** add glow to anything that is not live data; panels have no shadow.
- **Don't** add eyebrows, taglines or explanatory subtitles above or below page headings.
- **Don't** set text below 12px or use the mute colour for data.
- **Don't** introduce a second typeface; weight, case and tracking carry hierarchy.
- **Don't** use solid cyan fills except the single primary action and lit data marks (tape bars, swatches, the stepped-event flag).
- **Don't** paint a state in amber fill or leave its owner to colour alone: owner-colour blocks carry the team and the counts in text when they fit, and amber marks only the penalty that caused it.
