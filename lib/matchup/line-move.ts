import { sourceTag } from './format';

/** The part of an /api/odds-history entry the line-move rules need. */
export interface SourcedSnapshot {
    source?: string | null;
}

/**
 * True when a snapshot's prices come from a different book than the one
 * before it (Bovada → DraftKings). The price change on such a row is a book
 * switch, not a market move, so the line move shows no ▲/▼ for it. The feed a
 * book came through does not count: DraftKings via NHL and via ESPN are one
 * book. Unknown sources never count as a change.
 */
export function bookChanged(prev: SourcedSnapshot | null | undefined, cur: SourcedSnapshot | null | undefined): boolean {
    if (!prev || !cur) return false;
    const a = sourceTag(prev.source);
    const b = sourceTag(cur.source);
    return !!a && !!b && a !== b;
}

/** True when any consecutive pair in the list switches book (the open → latest summary is then cross-book). */
export function anyBookChange(entries: SourcedSnapshot[]): boolean {
    return entries.some((e, i) => i > 0 && bookChanged(entries[i - 1], e));
}
