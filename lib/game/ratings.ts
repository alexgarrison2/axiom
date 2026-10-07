/**
 * IMPACT EV ratings by player id (xG/60 added, xG/60 prevented), parsed from
 * public/data/player_ratings.json's columnar document. Pure, so the game page
 * (lib/game/fetch.ts) and the Pony Score generator (scripts/pony_scores.ts)
 * read it the same way.
 */
export type EvRatings = Map<number, { evOff: number; evDef: number }>;

export function parseRatings(doc: { columns?: string[]; rows?: unknown[][] } | null | undefined): EvRatings {
    const map: EvRatings = new Map();
    if (!doc?.columns || !doc.rows) return map;
    const ix = (c: string) => doc.columns!.indexOf(c);
    const iId = ix('id');
    const iOff = ix('ev_off') >= 0 ? ix('ev_off') : ix('off');
    const iDef = ix('ev_def') >= 0 ? ix('ev_def') : ix('def');
    if (iId < 0 || iOff < 0 || iDef < 0) return map;
    for (const r of doc.rows) {
        const off = Number(r[iOff]);
        const def = Number(r[iDef]);
        if (Number.isFinite(off) && Number.isFinite(def)) map.set(Number(r[iId]), { evOff: off, evDef: def });
    }
    return map;
}
