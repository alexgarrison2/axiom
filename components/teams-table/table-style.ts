/**
 * Shared cell styling for the dense team tables (league table, game log).
 * Zebra and hover are opaque colour mixes of --line into the panel colour,
 * so the sticky first column never lets scrolled cells show through.
 * Put `group` on the <tr>. Also zeroes the UA's 1px cell padding so an
 * h-8 cell is a 32px row.
 */
export const CELL_BG =
    'py-0 bg-surface-1 group-even:bg-[color-mix(in_srgb,var(--line)_40%,var(--surface-1))] group-hover:bg-[color-mix(in_srgb,var(--line)_85%,var(--surface-1))]';

/** Header cells: page background strip, 1px line under it, follows the page via --thead-y. */
export const HEAD_CELL = 'py-0 bg-bg border-b border-line [transform:translateY(var(--thead-y))]';

/** The sticky first column's right-edge shadow. */
export const STICKY_EDGE = 'sticky left-0 border-r border-line shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)]';
