# Rehearsal: SlateDemo

Gold: `dark-hero` (kept: dark window with corner bleed, inset top-left, off the right and bottom, depth from surface steps not shadow). Changed: the content is pony xG's own tonight view, the game rail and the preview pane, styled with the site's Neon Arcade tokens, crests from `/public/logos` and the win bar rebuilt from `components/ui/win-bar.tsx`.

Beats (wide, 760×500): 1. open on UTA @ TOR selected · 2. click WPG @ MTL: the ring slides down the rail, the pane's bar slides to 32/68, the % and xG roll, crests and goalies cross-fade, the factor bars re-balance · 3. click DET @ TBL, same response · 4. click UTA @ TOR, which is the opening frame, and the cursor returns to rest. Loop about 12s.

Beats (compact, 358×500, the phone column): the mobile site's stacked cards on a kit `Phone`. A finger swipes down one card, then another, holds, then flicks back to the top. Thrown on UIKit's curve. Loop about 11s.

Poster (reduced motion): DET @ TBL selected, the clearest favourite.

Captured: wide and 390 contact sheets, the first pane swap at fine spacing, a reduced-motion still, and a live check inside the Next app at desktop and phone widths (no console errors).

Film:
- `rehearsal passed` at both widths after the fixes below.
- Third card cut by the bottom → stage 440 → 500 tall.
- The tabs moved when a goalie name changed → `.px-lines` gets a fixed height.
- Crests snapped when they swapped → now a plain cross-fade in one grid cell.
- Loop seam: the cursor ended away from where it started → it moves back to rest at the end.
- Desktop window squashed to phone width → the compact design uses a `Phone` and the mobile card layout instead.
- Type under 10px on the phone → compact type set a step up.
- Second phone scroll did nothing (the list was too short), and the swipe landed short (stage px vs the phone's scaled points) → two more games added to the phone list, and the swipe distance is converted with a 100px probe.
- Hard edge where cards slide under the date → 14px mask fade on the list top.
- Lines that stand: `jump` at 0.2s is the web font arriving. A `settle snap` or `jump` of about 260px on a `Count` digit strip is the kit resetting the strip inside its own mask, and nothing visible moves. `layout: … leaves -93px` on the phone list is the list running past its clip on purpose.

Assumptions: tonight's real slate (Nov 3) as shown on ponyxg.com, frozen into the demo. Market tick and model diamond positions are approximate (the market is de-vigged from the shown lines).
Unresolved: the data is hard-coded, so the date and games go stale. The demo is not mounted on any page yet.
Not checked: the fresh-eye review (`references/review.md`), and Safari/Firefox.
