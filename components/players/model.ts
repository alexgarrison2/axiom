/**
 * Compact skater rows for /players: RAPM v2 ratings (public/data/player_ratings.json)
 * joined with counting stats from the season player boxscores. Built on the server
 * (lib/players/server.ts); pure functions here so the client can filter and sort.
 */

/** One season's regular-season counting line. */
export interface StatLine {
    gp: number;
    g: number;
    a: number;
    pts: number;
    sog: number;
    /** Average time on ice per game, seconds. */
    toi: number;
}

export interface Skater {
    id: string;
    name: string;
    team: string;
    /** 'C' | 'L' | 'R' | 'D' */
    pos: string;
    fwd: boolean;
    rookie: boolean;
    /** False: no NHL sample yet, the rating is his position group's rookie prior. */
    rated: boolean;
    /** EV xGF/60 impact (higher is better). */
    off: number;
    /** EV xGA/60 prevented (higher is better). */
    def: number;
    /** off + def. */
    net: number;
    /** Shrunk EV finishing: goals above xG per 60 from his own shots (not part of NET). Null/absent: no finishing column in the file. */
    fin?: number | null;
    /** off + fin. */
    offTotal?: number | null;
    /** The rating's EV sample: minutes and games, last three seasons + this one. */
    evMin: number;
    evGp: number;
    cur: StatLine | null;
    prev: StatLine | null;
}

export type StatSeason = 'cur' | 'prev';

export type SortKey = 'net' | 'off' | 'fin' | 'offTotal' | 'def' | 'evMin' | 'gp' | 'g' | 'a' | 'pts' | 'toi' | 'sogPg' | 'name';

/** Sort direction a column starts with (every rating is higher = better, so only the name starts ascending). */
export const FIRST_DIR: Partial<Record<SortKey, 'asc' | 'desc'>> = { name: 'asc' };

export interface SkaterFilter {
    q: string;
    team: string;
    pos: 'all' | 'F' | 'D';
    /** Minimum EV minutes behind the rating. */
    minEv: number;
    rookies: boolean;
}

export const DEFAULT_FILTER: SkaterFilter = { q: '', team: 'all', pos: 'all', minEv: 0, rookies: false };
export const MIN_EV_OPTIONS = [0, 250, 1000, 2500] as const;

/** Colour a rating only with this many EV minutes behind it. */
export const COLOR_MIN_EV = 250;

type Obj = Record<string, unknown>;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Ratings file columns -> objects (current-roster skaters only). */
export function rosterRatings(doc: unknown): Obj[] {
    if (!doc || typeof doc !== 'object') return [];
    const { columns, rows } = doc as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
    const out: Obj[] = [];
    for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const o: Obj = {};
        columns.forEach((c, i) => (o[String(c)] = r[i]));
        if (o.roster === true && typeof o.name === 'string' && o.name && o.pos !== 'G') out.push(o);
    }
    return out;
}

/**
 * Join the ratings with counting lines (keyed by NHL id) and rookie flags
 * (player_bio.json). Values are rounded for a small payload.
 */
export function compactSkaters(
    ratingsDoc: unknown,
    lines: { cur: Map<string, StatLine>; prev: Map<string, StatLine> },
    bio: unknown,
): Skater[] {
    const bios = (bio && typeof bio === 'object' ? bio : {}) as Record<string, Obj>;
    const out: Skater[] = [];
    for (const o of rosterRatings(ratingsDoc)) {
        if (!finite(o.off) || !finite(o.def) || !finite(o.net)) continue;
        const id = String(o.id);
        const fin = finite(o.fin) ? o.fin : null;
        const offTotal = finite(o.off_total) ? o.off_total : fin == null ? null : o.off + fin;
        const pos = String(o.pos ?? '');
        out.push({
            id,
            name: String(o.name),
            team: String(o.team ?? ''),
            pos,
            fwd: pos !== 'D',
            rookie: bios[id]?.isRookie === true,
            rated: o.rated !== false,
            off: Number(o.off.toFixed(2)),
            def: Number(o.def.toFixed(2)),
            net: Number(o.net.toFixed(2)),
            fin: fin == null ? null : Number(fin.toFixed(2)),
            offTotal: offTotal == null ? null : Number(offTotal.toFixed(2)),
            evMin: finite(o.toi) ? Math.round(o.toi) : 0,
            evGp: finite(o.gp) ? o.gp : 0,
            cur: lines.cur.get(id) ?? null,
            prev: lines.prev.get(id) ?? null,
        });
    }
    return out;
}

/** The value a column sorts and renders by (counting columns follow the season toggle). */
export function valueOf(p: Skater, key: Exclude<SortKey, 'name'>, season: StatSeason): number | null {
    switch (key) {
        case 'net':
        case 'off':
        case 'def':
        case 'evMin':
            return p[key];
        case 'fin':
        case 'offTotal':
            return p[key] ?? null;
        default: {
            const l = p[season];
            if (!l || !l.gp) return key === 'gp' ? 0 : null;
            if (key === 'sogPg') return l.sog / l.gp;
            return l[key];
        }
    }
}

export function filterSkaters(rows: Skater[], f: SkaterFilter): Skater[] {
    const q = f.q.trim().toLowerCase();
    return rows.filter(p => {
        if (p.evMin < f.minEv) return false;
        if (f.pos === 'F' && !p.fwd) return false;
        if (f.pos === 'D' && p.fwd) return false;
        if (f.team !== 'all' && p.team !== f.team) return false;
        if (f.rookies && !p.rookie) return false;
        if (q && !p.name.toLowerCase().includes(q) && p.team.toLowerCase() !== q) return false;
        return true;
    });
}

export function sortSkaters(rows: Skater[], key: SortKey, dir: 'asc' | 'desc', season: StatSeason = 'cur'): Skater[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (key === 'name') return sign * a.name.localeCompare(b.name);
        const av = valueOf(a, key, season);
        const bv = valueOf(b, key, season);
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1; // missing values always last
        if (bv == null) return -1;
        return sign * (av - bv) || a.name.localeCompare(b.name);
    });
}

/** Tone of a rating (higher is better for every one): green good / red bad past `strong`, only with a real sample. */
export function ratingTone(v: number, p: Pick<Skater, 'rated' | 'evMin'>, strong: number): 'pos' | 'neg' | null {
    if (!p.rated || p.evMin < COLOR_MIN_EV) return null;
    if (v >= strong) return 'pos';
    if (v <= -strong) return 'neg';
    return null;
}

/** Thresholds ≈ the top / bottom tenth of rostered skaters. */
export const STRONG = { net: 0.25, off: 0.18, def: 0.16, fin: 0.065, offTotal: 0.22 } as const;
