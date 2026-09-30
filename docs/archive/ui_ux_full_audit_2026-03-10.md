# UI/UX Full Audit

Date: 2026-03-10

Scope:
- Rendered review of the local site at `http://localhost:3000`
- Desktop and mobile screenshots captured across main surfaces in `output/playwright/audit/`
- Code review of layout, styling, animation, navigation, and major UI components
- Browser-console pass across core pages

## Executive Summary

This site is not generic. It has a real visual point of view on the main prediction surface: dark arena atmosphere, cyan/amber accents, a memorable logo treatment, and matchup cards that feel custom to the product. That is the good news.

The bad news is that the experience is not yet disciplined. The design system is strongest on the landing card grid, then falls apart as the user moves into tables, bracket views, team pages, and dense analysis surfaces. The result is a product with flashes of identity wrapped around too much admin-panel behavior, too many tiny labels, too much low-contrast table density, and a motion system that is expressive in places but not coherent end to end.

The highest-priority problem is not "make it prettier." It is "make the impressive parts govern the whole site instead of only the hero state."

## Frontend Stack Driving Presentation

- Framework: Next.js 16 App Router
- Styling: Tailwind CSS with custom utility classes in [app/globals.css](../../app/globals.css)
- Motion: Framer Motion in page/tab transitions and list reveals; GSAP for header/logo/team-page effects; Lenis wrapper exists but is not actively integrated
- UI primitives: shadcn/Radix inputs, tabs, sliders, selects
- Data-heavy rendering: large custom tables and grids in [components/TeamsTable.tsx](../../components/TeamsTable.tsx), [components/SkaterStatsTable.tsx](../../components/SkaterStatsTable.tsx), [components/team/GamesLogTable.tsx](../../components/team/GamesLogTable.tsx)

## Severity Scale

- 9-10: serious product-level issue hurting trust, usability, or identity
- 7-8: major design/system weakness
- 5-6: meaningful weakness, but not the first fix
- 3-4: polish debt
- 1-2: minor

## What Works

- The main matchup cards have genuine brand character. They do not look like default SaaS cards.
- The logo system and dark arena palette have enough specificity to avoid "template" energy.
- The News surface is cleaner and more editorial than the rest of the secondary pages.
- The Team selector overlay is one of the more refined interaction patterns in the product.

## Findings

### 1. Navigation architecture is overloaded and visually flat
Severity: 9.1

Evidence:
- [components/PredictionsViewer.tsx:327](../../components/PredictionsViewer.tsx#L327)
- [components/PredictionsViewer.tsx:369](../../components/PredictionsViewer.tsx#L369)
- [components/team/TeamHeader.tsx](../../components/team/TeamHeader.tsx)

Problem:
- Dates and product sections are mixed into one long chip rail.
- On mobile this becomes a horizontally scrolling strip of tiny all-caps pills with weak hierarchy and weak wayfinding.
- The site keeps making the user decode where they are instead of letting the page establish that clearly.
- Team pages introduce another top navigation pattern, so the system feels re-authored instead of continuous.

Why it matters:
- The navigation feels like controls were appended over time rather than composed.
- The visual language says "premium sports intelligence," but the information architecture says "one more tab."

Recommendations:
- Split navigation into two levels: primary site sections and date context.
- Turn date selection into a scoped control that only appears on prediction pages.
- Give active state more than color. Use scale, weight, and placement changes.
- On mobile, switch from endless chip rails to a compact segmented control plus overflow menu.
- Remove duplicate nav metaphors between the homepage and team pages.

### 2. Secondary surfaces collapse into admin-table aesthetics
Severity: 8.9

Evidence:
- [components/SkaterStatsTable.tsx:171](../../components/SkaterStatsTable.tsx#L171)
- [components/team/GamesLogTable.tsx:147](../../components/team/GamesLogTable.tsx#L147)
- [components/TeamsTable.tsx](../../components/TeamsTable.tsx)

Problem:
- The site repeatedly falls back to large, dense tables with tiny text, sticky columns, and compressed filters.
- This is especially severe on mobile, where pages become long strips of hard-to-parse numerical columns rather than designed analytical views.
- The Skaters page is the clearest example: huge vertical output, no chunking, weak hierarchy, and poor scanability.

Why it matters:
- The product stops feeling premium the second it becomes "database over dark background."
- Dense information is fine. Undesigned density is not.

Recommendations:
- Redesign table-heavy views into layered analytical surfaces: summary cards, leaderboards, expandable detail, comparison drawers.
- On mobile, default to cards or stacked rows with 4-6 key stats, not full tables.
- Use progressive disclosure for secondary stats instead of always rendering everything.
- Group columns by task, not by raw data availability.
- Introduce section-level narrative framing: top movers, biggest mismatches, strongest units, most fragile teams.

### 3. The motion system is expressive but fragmented
Severity: 8.3

Evidence:
- [components/PredictionsViewer.tsx:482](../../components/PredictionsViewer.tsx#L482)
- [components/Header.tsx](../../components/Header.tsx)
- [components/team/TeamHeader.tsx](../../components/team/TeamHeader.tsx)
- [components/FullLogoAnimated.tsx](../../components/FullLogoAnimated.tsx)
- [app/template.tsx](../../app/template.tsx)
- [components/SmoothScrolling.tsx](../../components/SmoothScrolling.tsx)

Problem:
- Framer Motion handles page and tab transitions.
- GSAP handles headers and logo behavior.
- Lenis exists but is not clearly part of the live experience.
- The result is not a unified motion language. It is several animation habits coexisting.
- Many transitions are generic fade/slide motions rather than semantically connected movements.

Why it matters:
- Premium motion should clarify structure, not merely decorate state changes.
- Right now animation effort is visible, but the system behind it is not.

Recommendations:
- Define a motion charter: page transition, section reveal, hover response, modal entrance, data change.
- Pick one primary runtime for most UI motion and reserve the second one for special cases.
- Replace repeated fade-up patterns with context-aware transitions.
- Add `prefers-reduced-motion` support across the stack.
- Remove unused motion infrastructure or fully integrate it.

### 4. The landing page has a real rendering-trust issue
Severity: 8.1

Evidence:
- [components/MatchupCard.tsx:430](../../components/MatchupCard.tsx#L430)
- Console audit found a hydration mismatch on the home page tied to random sparkline clip-path IDs

Problem:
- The home page throws a hydration mismatch because `Math.random()` is used to create SVG IDs during render.
- The user may not consciously name this, but they feel it as instability, softness, or "this page is slightly off."

Why it matters:
- The landing page is where the design is supposed to feel most precise.
- Trust in analytics products is partly visual correctness.

Recommendations:
- Replace random IDs with deterministic IDs from `useId()` or a stable prop-derived key.
- Eliminate all client/server render drift on the primary cards before doing more visual polish.

### 5. The bracket has ambition, but not enough responsive choreography
Severity: 7.9

Evidence:
- [components/PlayoffBracket.tsx:218](../../components/PlayoffBracket.tsx#L218)
- [components/PlayoffBracket.tsx:287](../../components/PlayoffBracket.tsx#L287)

Problem:
- Desktop bracket: visually distinctive, but surrounded by too much dead space and low-information emptiness.
- Mobile bracket: clipped, partial, and fundamentally not re-authored for a small screen.
- Hover-dependent detail is a desktop assumption that does not translate well.

Why it matters:
- This is one of the product's showcase features.
- It currently reads more like an internal projection visualization than a consumer-grade bracket experience.

Recommendations:
- Build separate desktop and mobile bracket layouts instead of scaling one composition.
- On desktop, tighten the stage and increase narrative framing around round progression.
- On mobile, use a stepped round carousel or collapsible series stack.
- Convert hover-only details into tap states or inline detail drawers.

### 6. Typography is conceptually on-brand but over-applied
Severity: 7.7

Evidence:
- [app/globals.css:61](../../app/globals.css#L61)

Problem:
- Fira Code is globally forced onto headings, table headers, and anything using `.font-mono`.
- That gives the product a terminal/sportsbook edge, but it also compresses hierarchy and reduces elegance.
- Too many labels are in tiny uppercase mono, which makes the entire site feel like one register.

Why it matters:
- Distinctive typography is good.
- Monolithic typography is not.

Recommendations:
- Keep the mono face for data, labels, and technical accents.
- Let display headlines use the sans face or a more sculpted display treatment.
- Increase contrast between editorial text, navigation text, stat labels, and raw numbers.
- Reduce the amount of 8-10px all-caps text across the interface.

### 7. Visual effects are overused and semantically inconsistent
Severity: 7.4

Evidence:
- [app/globals.css:73](../../app/globals.css#L73)
- [components/PredictionsViewer.tsx:612](../../components/PredictionsViewer.tsx#L612)

Problem:
- Glass panels, glow text, blur, neon borders, colored shadows, and gradient chips are used everywhere.
- The effect language loses meaning because too many elements ask for attention in the same way.
- Some pages feel like they inherited the style tokens but not the composition discipline.

Why it matters:
- Premium interfaces are selective with effects.
- When every element glows, nothing feels important.

Recommendations:
- Establish a rarity model for effects: hero, interactive emphasis, status, and background ambience.
- Reserve glow for the few things that truly matter.
- Reduce border noise on data-heavy surfaces.
- Use value contrast and spacing before reaching for blur, shadow, and chroma.

### 8. Team pages are information-rich but physically exhausting
Severity: 7.3

Evidence:
- [app/teams/[teamAbbr]/page.tsx](../../app/teams/[teamAbbr]/page.tsx)
- [components/team/GamesLogTable.tsx:147](../../components/team/GamesLogTable.tsx#L147)

Problem:
- The team experience opens into another compressed table-heavy environment.
- Sticky columns and dense rows do help preserve context, but they also create a spreadsheet mood.
- The page does not build enough analytical hierarchy before asking the user to parse game-level detail.

Why it matters:
- Team pages should feel like "deep dossier."
- Right now they feel like raw export plus a decent header.

Recommendations:
- Open team pages with a compact intelligence layer: current form, net rating, lineup health, starter confidence, key edges.
- Move the full game log below summary modules and collapsible filters.
- Make the chart and skater views stronger entry points rather than adjacent tabs that feel equally weighted.

### 9. The News surface is the most coherent secondary page, but it still lacks editorial hierarchy
Severity: 6.8

Evidence:
- [components/NewsSection.tsx:90](../../components/NewsSection.tsx#L90)

Problem:
- Every news card is visually similar.
- There is no differentiation between critical starter confirmation, injury, minor note, or low-impact update.
- The page is cleaner than the data tables, but it still reads as a feed, not as intelligence.

Recommendations:
- Create a tiered hierarchy: top alerts, confirmed starters, injuries, minor notes.
- Pin the most consequential items above the stream.
- Use stronger timestamp grouping and same-team clustering.
- Introduce outcome-aware summaries like "6 starting-goalie confirmations" or "3 major injury flags."

### 10. Performance and asset strategy are leaking into UX
Severity: 6.7

Evidence:
- [app/layout.tsx](../../app/layout.tsx)
- [components/FullLogoAnimated.tsx](../../components/FullLogoAnimated.tsx)
- Console audit reported the top logo image as LCP on multiple pages

Problem:
- Key above-the-fold logo assets are part of the perceived loading story.
- The animated full logo fetches its SVG client-side.
- Fonts are fetched from Google at build/runtime via `next/font/google`, which already caused build fragility in local verification.

Why it matters:
- Premium interfaces need crisp, immediate first paint.
- Loading behavior is part of visual quality.

Recommendations:
- Make the header/logo image eager when it is above the fold.
- Inline or statically import the hero logo SVG instead of fetching it after mount.
- Consider self-hosted fonts for more controlled rendering and build reliability.
- Audit above-the-fold image priority and reduce anything that delays the first branded frame.

### 11. Accessibility and comfort are under-addressed
Severity: 6.9

Evidence:
- No `prefers-reduced-motion` handling found across the animated stack
- Very small text is common across tabs, tables, labels, and metadata
- Several tab panels suppress visible focus outlines, for example [app/teams/[teamAbbr]/page.tsx:215](../../app/teams/[teamAbbr]/page.tsx#L215)

Problem:
- Heavy motion without reduced-motion alternatives excludes some users.
- Tiny all-caps labels are stylish in isolation but punishing at scale.
- Hidden scrollbars and horizontal overflows reduce affordance.

Recommendations:
- Implement `prefers-reduced-motion` gates for GSAP and Framer Motion.
- Raise the floor on text size for mobile and secondary labels.
- Restore clear focus affordances on all interactive surfaces.
- Do not rely on hidden scrollbars as a design strategy.

### 12. The design language is strongest in islands, not as a system
Severity: 6.5

Evidence:
- Main prediction cards feel authored
- Teams, History, Skaters, and Team pages each feel like separate products sharing a palette

Problem:
- There is a brand, but not yet a disciplined full-site design system.
- The site moves between cyber betting board, internal analytics grid, hockey feed, and dark dashboard.

Recommendations:
- Define a system for page archetypes: hero analysis, comparative table, dossier, bracket, feed.
- For each archetype, standardize header treatment, controls, density, and empty space rules.
- Design from page families, not component families alone.

## Priority Order

1. Fix rendering trust and navigation architecture
2. Re-architect data-heavy pages for hierarchy and mobile usability
3. Unify the motion system and add reduced-motion handling
4. Tighten typography and effect discipline
5. Rebuild the bracket and team-page responsive strategy

## Design Direction Recommendation

The correct next move is not to add more neon, more blur, or more animation. The site already has enough surface styling.

The next move is to become more editorial and more selective:
- fewer simultaneous signals
- stronger page-level hierarchy
- clearer separation between overview and deep detail
- more intentional motion
- mobile-first adaptations for dense analytics

The product should feel like a premium sports intelligence terminal, not a dark-mode spreadsheet wearing a glow kit.

