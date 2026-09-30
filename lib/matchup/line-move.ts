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

/**
 * Per row: did the book change since the last row whose book is known? A
 * snapshot from before the source column (source null) sits between two books
 * without hiding the switch: Bovada, unknown, DraftKings still flags the last row.
 */
export function bookSwitches(entries: SourcedSnapshot[]): boolean[] {
    let known: SourcedSnapshot | null = null;
    return entries.map(e => {
        const switched = bookChanged(known, e);
        if (sourceTag(e.source)) known = e;
        return switched;
    });
}

/** True when the list holds more than one book (the open → latest summary is then cross-book). */
export function anyBookChange(entries: SourcedSnapshot[]): boolean {
    return bookSwitches(entries).some(Boolean);
}
