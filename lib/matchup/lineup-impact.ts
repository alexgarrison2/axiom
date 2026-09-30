/**
 * Lineup impact, computed once on the server (app/api/matchup-details)
 * instead of in every expanded card: DailyFaceoff lineup players are
 * resolved to NHL player ids, impact values are looked up by id, and each
 * line / pairing is ranked against the same slot on every team's current
 * lineup.
 *
 * Name resolution is strict: exact full name (diacritics folded), preferring
 * the player's own team; the only fallback is same team + same first
 * initial + same surname. There is no bare last-name fallback, so two
 * Tkachuks never share a value.
 */
import type { LineImpact, LineupPlayerView } from '../../types/prediction';
import { disambiguate } from './format';

export interface ImpactPlayer {
    name: string;
    team: string;
    is_forward?: boolean;
    games_played?: number;
    impact_score?: number | null;
    xgaa_per_game?: number | null;
}

export type ImpactData = Record<string, ImpactPlayer>;

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

export function normName(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’-]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
}

interface Entry {
    id: number;
    team: string;
    first: string;
    last: string;
    impact: number | null;
}

export interface ImpactIndex {
    resolve(name: string, team: string): Entry | null;
}

function impactOf(p: ImpactPlayer): number | null {
    if ((p.games_played ?? 0) <= 0) return null;
    const v = p.impact_score ?? p.xgaa_per_game;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function buildIndex(data: ImpactData): ImpactIndex {
    const byFull = new Map<string, Entry[]>();
    const byTeamLast = new Map<string, Entry[]>();
    for (const [id, p] of Object.entries(data)) {
        if (!p?.name) continue;
        const n = normName(p.name);
        const parts = n.split(' ');
        const e: Entry = { id: Number(id), team: p.team, first: parts[0] ?? '', last: parts.slice(1).join(' '), impact: impactOf(p) };
        (byFull.get(n) ?? byFull.set(n, []).get(n)!).push(e);
        const k = `${p.team}|${parts.at(-1)}`;
        (byTeamLast.get(k) ?? byTeamLast.set(k, []).get(k)!).push(e);
    }
    return {
        resolve(name, team) {
            const n = normName(name);
            const full = byFull.get(n);
            if (full?.length) return full.find(e => e.team === team) ?? (full.length === 1 ? full[0] : null);
            const parts = n.split(' ');
            const cands = (byTeamLast.get(`${team}|${parts.at(-1)}`) ?? []).filter(e => e.first.charAt(0) === (parts[0] ?? '').charAt(0));
            return cands.length === 1 ? cands[0] : null;
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
    const grade = g.found >= 10 ? { value: Math.round(g.value * 10) / 10, ...(ctx.grades.length > 1 ? { rank: rankIn(ctx.grades, g.value).rank, outOf: rankIn(ctx.grades, g.value).outOf } : { rank: null, outOf: 0 }) } : null;
    return { lines, lineImpacts, grade };
}
