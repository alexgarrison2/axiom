import { pct3 } from '@/utils/team-stats/format';
import type { GoalieLine, GoalieSeason } from '@/utils/team-stats/team-types';

export type GoalieState = 'confirmed' | 'likely' | 'projected';

/** Starter status → colour state (green / faded green / grey). Colour only, never words on screen. */
export function goalieState(status: string | null | undefined): GoalieState {
    const s = (status ?? '').toLowerCase();
    if (s.includes('confirm') && !s.includes('unconfirm')) return 'confirmed';
    if (s.includes('likely') || s.includes('expected') || s.includes('probable')) return 'likely';
    return 'projected';
}

/** Display-face goalie-name class per state: confirmed glows green, likely is faded green, projected is grey. */
export const GOALIE_NAME: Record<GoalieState, string> = {
    confirmed: 'glow-green',
    likely: 'text-pos/70',
    projected: 'text-fg-2',
};

export const svPct = (s: GoalieSeason) => (s.sa > 0 ? pct3(s.sv / s.sa) : '—');
export const gaa = (s: GoalieSeason) => (s.toi > 0 ? ((s.ga * 3600) / s.toi).toFixed(2) : '—');

/** "3-1-0 · .915 · 2.40" */
export const seasonLine = (s: GoalieSeason) => `${s.w}-${s.l}-${s.ot} · ${svPct(s)} · ${gaa(s)}`;

/**
 * The tiny stat line under a goalie name: this season once he has played,
 * otherwise last season (the caller tags it "25-26").
 */
export function goalieStatLine(current: GoalieSeason | null, last: GoalieSeason | null): { text: string; prior: boolean } | null {
    if (current && current.gp > 0) return { text: seasonLine(current), prior: false };
    if (last && last.gp > 0) return { text: seasonLine(last), prior: true };
    return null;
}

/** Out beyond day-to-day (IR / LTIR / suspended). */
export function goalieOut(g: Pick<GoalieLine, 'injury'>): boolean {
    return !!g.injury && !g.injury.status.toLowerCase().includes('day');
}

/**
 * Depth-chart order: the named starter for the next game, then this
 * season's games played, then the model rating; goalies who are out go last.
 */
export function orderGoalies<T extends GoalieLine>(goalies: T[]): T[] {
    const key = (g: T) => [goalieOut(g) ? 1 : 0, g.next ? 0 : 1, -(g.current?.gp ?? 0), -(g.rating?.gsaxPerGame ?? -99), -(g.last?.gs ?? 0)];
    return [...goalies].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return a.name.localeCompare(b.name);
    });
}
