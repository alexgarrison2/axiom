/**
 * Compact skater rows for /players: the player ratings (public/data/player_ratings.json,
 * parsed by name in lib/players/ratings.ts) joined with counting stats from the season
 * player boxscores. Built on the server (lib/players/server.ts); pure functions here so
 * the client can filter and sort.
 *
 * A v3 / v4 file carries the per-game IMPACT headline (goals per 82 above the F / D
 * average); a v2 file has only the EV per-60 rates, so its rows have impact = null and
 * the table falls back to NET per 60.
 */
import { parseRatings, posGroup, type PositionMeans, type RateKey } from '@/lib/players/ratings';

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
    /** Goals per 82 games above the position average = offImp + defImp. Null: v2 file. */
    impact: number | null;
    /** Goals / 82: EV + PP offence, finishing, penalties drawn. */
    offImp: number | null;
    /** Goals / 82: EV + PK defence, minus penalties taken. */
    defImp: number | null;
    /** Posterior SD of impact. */
    sd: number | null;
    /** Goals / 82 from penalties drawn minus taken (inside offImp / defImp). Null before v4. */
    pen: number | null;
    /** Production: recency-weighted Game Score per 82 above the position average (descriptive). Null: no column. */
    prod: number | null;
    /** EV xGF/60 added (vs the position average when the file has position means). */
    evOff: number;
    /** EV xGA/60 prevented (higher is better; same baseline as evOff). */
    evDef: number;
    /** PP xGF/60 added / PK xGA/60 prevented vs the position average. Null before v3. */
    pp: number | null;
    pk: number | null;
    /** Shrunk EV finishing: goals above xG per 60 on his own shots. Null: no column. */
    fin: number | null;
    /** EV xG/60 net (off + def vs an average skater): the v2 headline. */
    net: number;
    /** Expected PP / PK minutes per game (his role). Null before v3. */
    ppGp: number | null;
    pkGp: number | null;
    /** The rating's EV sample: minutes and games, last three seasons + this one. */
    evMin: number;
    evGp: number;
    cur: StatLine | null;
    prev: StatLine | null;
}

export type StatSeason = 'cur' | 'prev';

export type SortKey =
    | 'impact'
    | 'prod'
    | 'offImp'
    | 'defImp'
    | 'pen'
    | 'evOff'
    | 'evDef'
    | 'pp'
    | 'pk'
    | 'fin'
    | 'net'
    | 'evMin'
    | 'gp'
    | 'g'
    | 'a'
    | 'pts'
    | 'toi'
    | 'sogPg'
    | 'name';

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
/** PP / PK rates of a player with less expected time per game than this are greyed (he barely plays there). */
export const SPECIAL_TEAMS_MIN_GP = 0.5;

const round = (v: number, d: number) => Number(v.toFixed(d));
const r2 = (v: number | undefined) => (v == null ? null : round(v, 2));

/**
 * Join the ratings with counting lines (keyed by NHL id) and rookie flags
 * (player_bio.json). Current-roster skaters only; values rounded for a small payload.
 */
export function compactSkaters(
    ratingsDoc: unknown,
    lines: { cur: Map<string, StatLine>; prev: Map<string, StatLine> },
    bio: unknown,
): Skater[] {
    const bios = (bio && typeof bio === 'object' ? bio : {}) as Record<string, { isRookie?: unknown }>;
    const ratings = parseRatings(ratingsDoc);
    const means: PositionMeans | null = ratings.positionMeans;
    const out: Skater[] = [];
    for (const p of ratings.byId.values()) {
        if (!p.roster || !p.name || p.pos === 'G') continue;
        const id = String(p.id);
        const m = means?.[posGroup(p.pos)];
        /** Per 60 vs the position average (the impact's baseline); raw when the file has no means. */
        const rate = (v: number | undefined, k: RateKey) => (v == null ? null : round(v - (m?.[k] ?? 0), 3));
        out.push({
            id,
            name: p.name,
            team: p.team,
            pos: p.pos,
            fwd: p.pos !== 'D',
            rookie: bios[id]?.isRookie === true,
            rated: p.rated,
            impact: r2(p.impact),
            offImp: r2(p.offImpact),
            defImp: r2(p.defImpact),
            sd: r2(p.sd),
            pen: r2(p.penImpact),
            prod: p.prod == null ? null : round(p.prod, 1),
            evOff: rate(p.off, 'ev_off')!,
            evDef: rate(p.def, 'ev_def')!,
            pp: rate(p.ppOff, 'pp_off'),
            pk: rate(p.pkDef, 'pk_def'),
            fin: rate(p.fin, 'fin'),
            net: round(p.net, 3),
            ppGp: r2(p.toiPpGp),
            pkGp: r2(p.toiPkGp),
            evMin: Math.round(p.toi),
            evGp: p.gp,
            cur: lines.cur.get(id) ?? null,
            prev: lines.prev.get(id) ?? null,
        });
    }
    return out;
}

/** The headline the table opens on: IMPACT when the file has it (v3+), else EV NET per 60 (v2). */
export function headlineKey(rows: Skater[]): 'impact' | 'net' {
    return rows.some(p => p.impact != null) ? 'impact' : 'net';
}

/** The value a column sorts and renders by (counting columns follow the season toggle). */
export function valueOf(p: Skater, key: Exclude<SortKey, 'name'>, season: StatSeason): number | null {
    switch (key) {
        case 'impact':
        case 'prod':
        case 'offImp':
        case 'defImp':
        case 'pen':
        case 'evOff':
        case 'evDef':
        case 'pp':
        case 'pk':
        case 'fin':
        case 'net':
        case 'evMin':
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

/** Tone of a rating (higher is better for every one): good / bad past `strong`, only with a real sample. */
export function ratingTone(v: number, p: Pick<Skater, 'rated' | 'evMin'>, strong: number): 'pos' | 'neg' | null {
    if (!p.rated || p.evMin < COLOR_MIN_EV) return null;
    if (v >= strong) return 'pos';
    if (v <= -strong) return 'neg';
    return null;
}

/**
 * Thresholds ≈ the top / bottom tenth of rostered skaters with 250+ EV minutes
 * (goals / 82 for impact, offImp, defImp, pen; Game Score / 82 for prod; per 60 for the rates;
 * net is the v2 EV rating).
 */
export const STRONG = {
    impact: 5,
    prod: 25,
    offImp: 4,
    defImp: 2.5,
    pen: 0.9,
    evOff: 0.2,
    evDef: 0.14,
    pp: 0.25,
    pk: 0.16,
    fin: 0.05,
    net: 0.25,
} as const;
