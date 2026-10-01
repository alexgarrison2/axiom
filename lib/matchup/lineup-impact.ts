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
import type { LineImpact, LineupPlayerView } from '../../types/prediction';
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
}

export interface ImpactIndex {
    resolve(name: string, team: string): Entry | null;
}

/** Name -> NHL id + NET from the ratings file. */
export function buildIndex(ratings: Ratings): ImpactIndex {
    const find = nameIndex(ratings);
    return {
        resolve(name, team) {
            const p = find(name, team);
            return p ? { id: p.id, impact: p.rated ? p.net : null } : null;
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
        const v = index.resolve(p.name, team)?.impact;
        if (v == null) return null;
        t += v;
    }
    return t;
}

function gradeOf(index: ImpactIndex, lineup: DfoLineup, team: string): { value: number; found: number } {
    let value = 0;
    let found = 0;
    for (const [key] of SLOTS) {
        for (const p of playersIn(lineup, key)) {
            const v = index.resolve(p.name, team)?.impact;
            if (v != null) {
                value += v;
                found++;
            }
        }
    }
    return { value, found };
}

export interface LeagueContext {
    index: ImpactIndex;
    /** Sorted slot totals across every team's current lineup. */
    dist: Record<string, number[]>;
    grades: number[];
}

export function leagueContext(index: ImpactIndex, allLineups: Record<string, DfoLineup>): LeagueContext {
    const dist: Record<string, number[]> = {};
    for (const [key] of SLOTS) dist[key] = [];
    const grades: number[] = [];
    for (const [team, lu] of Object.entries(allLineups)) {
        if (!lu || typeof lu !== 'object') continue;
        for (const [key, req] of SLOTS) {
            const t = slotTotal(index, lu, team, key, req);
            if (t != null) dist[key].push(t);
        }
        const g = gradeOf(index, lu, team);
        if (g.found >= 10) grades.push(g.value);
    }
    for (const k of Object.keys(dist)) dist[k].sort((a, b) => a - b);
    grades.sort((a, b) => a - b);
    return { index, dist, grades };
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
    grade: { value: number; rank: number | null; outOf: number } | null;
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
            const e = ctx.index.resolve(p.name, team);
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
    const grade = g.found >= 10 ? { value: Math.round(g.value * 100) / 100, ...(ctx.grades.length > 1 ? { rank: rankIn(ctx.grades, g.value).rank, outOf: rankIn(ctx.grades, g.value).outOf } : { rank: null, outOf: 0 }) } : null;
    return { lines, lineImpacts, grade };
}
