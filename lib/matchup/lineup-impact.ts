/**
 * Lineup ratings, computed once on the server (app/api/matchup-details)
 * instead of in every expanded card: DailyFaceoff lineup players are
 * resolved to NHL player ids, each gets his RAPM NET (EV xG/60 above
 * average, lib/players/ratings.ts), and each line / pairing total is ranked
 * against the same slot on every team's current lineup.
 *
 * Name resolution is strict: exact full name (diacritics folded), preferring
 * the player's own team; the only fallback is same team + same first
 * initial + same surname. There is no bare last-name fallback, so two
 * Tkachuks never share a value.
 */
import type { LineImpact, LineupGrade, LineupPlayerView } from '../../types/prediction';
import { nameIndex, type Ratings } from '../players/ratings';
import { disambiguate } from './format';

export interface DfoPlayer {
    name: string;
    pos?: string;
    ppUnit?: number | null;
    movement?: string | null;
}

export type DfoLineup = Record<string, unknown>;

export const FWD_LINES = ['f1', 'f2', 'f3', 'f4'] as const;
export const DEF_PAIRS = ['d1', 'd2', 'd3'] as const;
const SLOTS: [string, number][] = [
    ['f1', 3], ['f2', 3], ['f3', 3], ['f4', 3],
    ['d1', 2], ['d2', 2], ['d3', 2],
];

interface Entry {
    id: number;
    /** NET, EV xG/60 above average; null for a skater with no NHL sample yet (rookie prior). */
    impact: number | null;
    /** RAPM components behind the NET (EV xG/60 above average); null when unrated or absent from the file. */
    off: number | null;
    def: number | null;
    fin: number | null;
}

export interface ImpactIndex {
    /** `def`: the player sits in a defence pair (breaks a same-name tie). */
    resolve(name: string, team: string, def?: boolean): Entry | null;
}

/** Name -> NHL id + NET from the ratings file. */
export function buildIndex(ratings: Ratings): ImpactIndex {
    const find = nameIndex(ratings);
    return {
        resolve(name, team, def) {
            const p = find(name, team, null, def);
            return p ? { id: p.id, impact: p.rated ? p.net : null, off: p.rated ? p.off : null, def: p.rated ? p.def : null, fin: p.rated ? (p.fin ?? null) : null } : null;
        },
    };
}

function playersIn(lineup: DfoLineup, key: string): DfoPlayer[] {
    const v = lineup[key];
    return Array.isArray(v) ? (v.filter(p => p && typeof (p as DfoPlayer).name === 'string') as DfoPlayer[]) : [];
}

function slotTotal(index: ImpactIndex, lineup: DfoLineup, team: string, key: string, required: number): number | null {
    const ps = playersIn(lineup, key);
    if (ps.length < required) return null;
    let t = 0;
    for (const p of ps.slice(0, required)) {
        const v = index.resolve(p.name, team, key.startsWith('d'))?.impact;
        if (v == null) return null;
        t += v;
    }
    return t;
}

export const PARTS = ['off', 'fin', 'def', 'net'] as const;
export type Part = (typeof PARTS)[number];
export type PartTotals = Record<Part, number>;

function gradeOf(index: ImpactIndex, lineup: DfoLineup, team: string): { value: number; found: number; parts: PartTotals } {
    let value = 0;
    let found = 0;
    const parts: PartTotals = { off: 0, fin: 0, def: 0, net: 0 };
    for (const [key] of SLOTS) {
        for (const p of playersIn(lineup, key)) {
            const e = index.resolve(p.name, team, key.startsWith('d'));
            const v = e?.impact;
            if (e && v != null) {
                value += v;
                found++;
                parts.off += e.off ?? 0;
                parts.fin += e.fin ?? 0;
                parts.def += e.def ?? 0;
                parts.net += v;
            }
        }
    }
    return { value, found, parts };
}

export interface LeagueContext {
    index: ImpactIndex;
    /** Sorted slot totals across every team's current lineup. */
    dist: Record<string, number[]>;
    grades: number[];
    /** Sorted lineup totals per component across every team's current lineup. */
    partDist: Record<Part, number[]>;
}

export function leagueContext(index: ImpactIndex, allLineups: Record<string, DfoLineup>): LeagueContext {
    const dist: Record<string, number[]> = {};
    for (const [key] of SLOTS) dist[key] = [];
    const grades: number[] = [];
    const partDist: Record<Part, number[]> = { off: [], fin: [], def: [], net: [] };
    for (const [team, lu] of Object.entries(allLineups)) {
        if (!lu || typeof lu !== 'object') continue;
        for (const [key, req] of SLOTS) {
            const t = slotTotal(index, lu, team, key, req);
            if (t != null) dist[key].push(t);
        }
        const g = gradeOf(index, lu, team);
        if (g.found >= 10) {
            grades.push(g.value);
            for (const k of PARTS) partDist[k].push(g.parts[k]);
        }
    }
    for (const k of Object.keys(dist)) dist[k].sort((a, b) => a - b);
    grades.sort((a, b) => a - b);
    for (const k of PARTS) partDist[k].sort((a, b) => a - b);
    return { index, dist, grades, partDist };
}

function rankIn(sorted: number[], v: number): { rank: number; outOf: number; pct: number } {
    // Include this value if it isn't already part of the distribution.
    const d = sorted.includes(v) ? sorted : [...sorted, v];
    const outOf = d.length;
    return { rank: d.filter(x => x > v).length + 1, outOf, pct: (d.filter(x => x < v).length / outOf) * 100 };
}

export interface LineupView {
    lines: Record<string, LineupPlayerView[]>;
    lineImpacts: Record<string, LineImpact | null>;
    grade: LineupGrade | null;
}

const MOVES = new Set(['up', 'down', 'new']);

export function lineupView(ctx: LeagueContext, lineup: DfoLineup | null | undefined, team: string): LineupView | null {
    if (!lineup || typeof lineup !== 'object') return null;
    const allNames = SLOTS.flatMap(([k]) => playersIn(lineup, k).map(p => p.name));
    if (!allNames.length) return null;
    const display = disambiguate(allNames);
    const lines: Record<string, LineupPlayerView[]> = {};
    const lineImpacts: Record<string, LineImpact | null> = {};
    for (const [key, req] of SLOTS) {
        lines[key] = playersIn(lineup, key).map(p => {
            const e = ctx.index.resolve(p.name, team, key.startsWith('d'));
            return {
                playerId: e?.id ?? null,
                name: p.name,
                display: display.get(p.name) ?? p.name,
                pos: (p.pos ?? '').toUpperCase(),
                ppUnit: p.ppUnit === 1 || p.ppUnit === 2 ? p.ppUnit : null,
                movement: p.movement && MOVES.has(p.movement) ? (p.movement as LineupPlayerView['movement']) : null,
                impact: e?.impact != null ? Math.round(e.impact * 100) / 100 : null,
            };
        });
        const total = slotTotal(ctx.index, lineup, team, key, req);
        lineImpacts[key] = total == null || !ctx.dist[key]?.length ? null : { total: Math.round(total * 100) / 100, ...rankIn(ctx.dist[key], total) };
    }
    const g = gradeOf(ctx.index, lineup, team);
    const parts = g.found >= 10 ? Object.fromEntries(PARTS.map(k => [k, { value: Math.round(g.parts[k] * 100) / 100, rank: ctx.partDist[k].length > 1 ? rankIn(ctx.partDist[k], g.parts[k]).rank : null, outOf: ctx.partDist[k].length, min: ctx.partDist[k][0] ?? 0, max: ctx.partDist[k][ctx.partDist[k].length - 1] ?? 0 }])) as LineupGrade['parts'] : undefined;
    const grade: LineupGrade | null = g.found >= 10 ? {
        parts, value: Math.round(g.value * 100) / 100, ...(ctx.grades.length > 1 ? { rank: rankIn(ctx.grades, g.value).rank, outOf: rankIn(ctx.grades, g.value).outOf } : { rank: null, outOf: 0 }) } : null;
    return { lines, lineImpacts, grade };
}
