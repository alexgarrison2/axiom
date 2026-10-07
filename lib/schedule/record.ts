/**
 * Expected standings points and record for a run of games (a month, a road
 * trip, the season): actual results for games played, the model's per-game
 * outcome probabilities for the rest. Method on /methodology#schedule.
 */
import type { SchedGame } from './metrics';

/**
 * Share of regular-season games that reach overtime or a shootout, pooled
 * over 2022-23 to 2025-26 (5,056 games, pipeline/nhl_historical_gamestats.csv:
 * 23.0%, 20.7%, 21.0%, 24.9%). Only used when a game's forecast has no
 * regulation / OT split of its own (the simulator and the day's predictions do).
 */
export const OT_SHARE = 0.225;

/** z for the 10th / 90th percentile of a normal. */
const Z90 = 1.2816;

export interface Outcome {
    /** P(win, any way). */
    w: number;
    /** P(loss in OT or a shootout): one point. */
    otl: number;
}

/** The team's outcome probabilities for a game ahead (null without a forecast). */
export function outcomeOf(g: Pick<SchedGame, 'winPct'>): Outcome | null {
    if (!g.winPct) return null;
    const w = Math.min(1, Math.max(0, g.winPct.pct / 100));
    // Without the model's own OT split: every team reaches OT equally often and loses it as often as it loses overall.
    const otl = g.winPct.otl != null ? g.winPct.otl / 100 : OT_SHARE * (1 - w);
    return { w, otl: Math.min(1 - w, Math.max(0, otl)) };
}

export const expectedPoints = (o: Outcome) => 2 * o.w + o.otl;

/** Variance of one game's points (0, 1 or 2). */
const pointsVariance = (o: Outcome) => 4 * o.w + o.otl - expectedPoints(o) ** 2;

/**
 * Round non-negative values that sum to `total` to integers that still sum
 * to `total` (largest remainder; ties go to the earlier value).
 */
export function largestRemainder(values: number[], total: number): number[] {
    const floors = values.map(v => Math.floor(v + 1e-9));
    let left = total - floors.reduce((a, b) => a + b, 0);
    const order = values.map((v, i) => ({ i, r: v - Math.floor(v + 1e-9) })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const { i } of order) {
        if (left <= 0) break;
        floors[i] += 1;
        left -= 1;
    }
    return floors;
}

export interface Record3 {
    w: number;
    l: number;
    otl: number;
}

export interface RecordProjection {
    games: number;
    possible: number;
    played: number;
    /** Results so far. */
    actual: Record3;
    actualPts: number;
    /** Games ahead with a forecast; null when none are left (or some lack one). */
    ahead: number;
    /** Projected full record (actual + rounded expectation for the rest). */
    record: Record3 | null;
    /** Expected points, actual + Σ(2·P(W) + P(OTL)) over the games ahead. */
    pts: number | null;
    /** 10th-90th percentile of points (normal approximation over independent games). */
    range: [number, number] | null;
}

export function projectRecord(games: Pick<SchedGame, 'result' | 'winPct' | 'state'>[]): RecordProjection {
    const actual: Record3 = { w: 0, l: 0, otl: 0 };
    const outs: Outcome[] = [];
    let missing = 0;
    for (const g of games) {
        if (g.result) {
            if (g.result.code === 'W') actual.w += 1;
            else if (g.result.code === 'OTL') actual.otl += 1;
            else actual.l += 1;
            continue;
        }
        const o = outcomeOf(g);
        if (o) outs.push(o);
        else missing += 1;
    }
    const played = actual.w + actual.l + actual.otl;
    const actualPts = 2 * actual.w + actual.otl;
    const base = { games: games.length, possible: 2 * games.length, played, actual, actualPts, ahead: outs.length };
    if (!outs.length || missing) return { ...base, record: null, pts: null, range: null };

    const ew = outs.reduce((s, o) => s + o.w, 0);
    const eo = outs.reduce((s, o) => s + o.otl, 0);
    const n = outs.length;
    const [w, l, otl] = largestRemainder([ew, n - ew - eo, eo], n);
    const mean = outs.reduce((s, o) => s + expectedPoints(o), 0);
    const sd = Math.sqrt(outs.reduce((s, o) => s + pointsVariance(o), 0));
    const lo = Math.max(0, Math.round(actualPts + mean - Z90 * sd));
    const hi = Math.min(actualPts + 2 * n, Math.round(actualPts + mean + Z90 * sd));
    return {
        ...base,
        record: { w: actual.w + w, l: actual.l + l, otl: actual.otl + otl },
        pts: actualPts + mean,
        range: n >= 3 ? [lo, hi] : null,
    };
}

export const recordText = (r: Record3) => `${r.w}-${r.l}-${r.otl}`;
