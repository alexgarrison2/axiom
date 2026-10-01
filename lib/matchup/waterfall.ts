/**
 * "Why this pick": home_wp_breakdown → waterfall steps from a coin flip
 * (50%) to the published home win %. Positive deltas favour the home team.
 */
import type { Prediction, WpFactor } from '../../types/prediction';

export interface WaterfallStep {
    factor: string;
    label: string;
    delta: number;
    /** Running home win % before / after this factor. */
    from: number;
    to: number;
}

export interface Waterfall {
    steps: WaterfallStep[];
    start: number;
    /** Home win % after every factor (≈ published home win %). */
    end: number;
    /** Axis range (home win %), padded, always containing 50. */
    min: number;
    max: number;
}

/** Friendlier labels for factor keys the fan sees. */
const LABELS: Record<string, string> = {
    home_ice: 'Home ice',
    strength_5v5: '5-on-5 play',
    special_teams: 'Special teams',
    goaltending: 'Goaltending',
    rest: 'Rest & travel',
    lineup: 'Lineups & injuries',
    lineup_goalie: 'Lineup & starter vs usual',
    market: 'Betting market',
};

export function buildWaterfall(breakdown: WpFactor[], start = 50): Waterfall | null {
    if (!breakdown.length) return null;
    let run = start;
    const steps: WaterfallStep[] = breakdown.map(f => {
        const from = run;
        run = run + f.wp_delta_pts;
        return { factor: f.factor, label: LABELS[f.factor] ?? f.label ?? f.factor, delta: f.wp_delta_pts, from, to: run };
    });
    const values = [start, ...steps.map(s => s.to)];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(1.5, (hi - lo) * 0.12);
    return { steps, start, end: run, min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
}

export function waterfallFor(p: Prediction): Waterfall | null {
    return buildWaterfall(p.breakdown);
}

/** Position (0–100%) of a home win % on the waterfall axis. */
export function axisPos(w: Waterfall, v: number): number {
    return ((v - w.min) / (w.max - w.min)) * 100;
}

/** The biggest factors (by size), for plain-English copy. */
export function topFactors(w: Waterfall, n = 2): WaterfallStep[] {
    return [...w.steps].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, n).filter(s => Math.abs(s.delta) >= 0.1);
}
