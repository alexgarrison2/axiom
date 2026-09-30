import { pct3 } from '@/utils/team-stats/format';
import type { GoalieSeason } from '@/utils/team-stats/team-types';

export type GoalieState = 'confirmed' | 'likely' | 'projected';

/** Starter status → colour state (green / faded green / grey). Colour only, never words on screen. */
export function goalieState(status: string | null | undefined): GoalieState {
    const s = (status ?? '').toLowerCase();
    if (s.includes('confirm') && !s.includes('unconfirm')) return 'confirmed';
    if (s.includes('likely') || s.includes('expected') || s.includes('probable')) return 'likely';
    return 'projected';
}

/** Chakra goalie-name class per state: confirmed glows green, likely is faded green, projected is grey. */
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
