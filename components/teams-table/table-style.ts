/**
 * Shared cell styling for the dense team tables (league table, game log).
 * Zebra and hover are opaque colour mixes of --line into the panel colour,
 * so the sticky first column never lets scrolled cells show through.
 * Put `group` on the <tr>. Also zeroes the UA's 1px cell padding so an
 * h-8 cell is a 32px row.
 */
export const CELL_BG =
    'py-0 bg-surface-1 group-even:bg-[color-mix(in_srgb,var(--line)_40%,var(--surface-1))] group-hover:bg-[color-mix(in_srgb,var(--line)_85%,var(--surface-1))]';

/**
 * Header cells: opaque page-background strip with a 1px line under it, stuck
 * to the top of the table's own scroll container (native `position: sticky`;
 * the container scrolls on both axes, see SCROLLER). A second header row
 * overrides `top-0` with the first row's height.
 */
export const HEAD_CELL = 'py-0 bg-bg border-b border-line sticky top-0 z-[3]';

/** The sticky first column's right-edge shadow. Header corner cells add HEAD_CELL and `z-[4]`. */
export const STICKY_EDGE = 'sticky left-0 border-r border-line shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)]';

/**
 * The scroll container for a sticky-header table: scrolls on both axes and is
 * at most one viewport tall (below the app bar, and above the fixed bottom tab
 * bar on phones), so the header row and first column stay pinned while the
 * page itself scrolls normally around it.
 */
export const SCROLLER =
    'overflow-auto overscroll-x-contain max-h-[calc(100dvh-var(--appbar-h)-var(--tabbar-h)-env(safe-area-inset-bottom)-12px)] md:max-h-[calc(100dvh-var(--appbar-h)-16px)] focus-visible:outline-offset-[-2px]';
