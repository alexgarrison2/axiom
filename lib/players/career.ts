/*
 * Career-table helpers (pure, no server imports): the hockey season age and the
 * season grouping that makes a split season (a trade, or a club season plus a
 * tournament) read as one block.
 */

/**
 * Season age, the Hockey-Reference convention: the player's age on February 1
 * of the season, e.g. season 20152016 -> his age on 2016-02-01.
 */
export function seasonAge(birth: string | null | undefined, season: number): number | null {
    if (!birth || !season) return null;
    const b = new Date(`${birth}T00:00:00Z`);
    if (Number.isNaN(b.getTime())) return null;
    const year = season % 10000;
    let age = year - b.getUTCFullYear();
    // Born after February 1 of that year: not yet had the birthday.
    if (b.getUTCMonth() > 1 || (b.getUTCMonth() === 1 && b.getUTCDate() > 1)) age--;
    return age;
}

export interface Grouped<T> {
    line: T;
    /** First row of its season block: shows the season and age. */
    first: boolean;
    /** Last row of its season block: takes the full divider. */
    last: boolean;
    /** Alternating band per season block (0, 1, 0, ...), newest first. */
    band: 0 | 1;
}

/** Newest season first, the feed's order within a season (first club, then traded-to club, then tournaments). */
export function groupBySeason<T extends { season: number; seq?: number }>(lines: T[]): Grouped<T>[] {
    const sorted = lines
        .map((line, i) => ({ line, i }))
        .sort((a, b) => b.line.season - a.line.season || (a.line.seq ?? 0) - (b.line.seq ?? 0) || a.i - b.i)
        .map(x => x.line);
    let band: 0 | 1 = 1;
    return sorted.map((line, i) => {
        const first = i === 0 || sorted[i - 1].season !== line.season;
        if (first) band = band === 0 ? 1 : 0;
        const last = i === sorted.length - 1 || sorted[i + 1].season !== line.season;
        return { line, first, last, band };
    });
}
