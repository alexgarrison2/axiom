import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { pickSummaries } = await import('../details-server');
const { goalieStartsGsax } = await import('../../../utils/team-stats/game-row');

describe('OUR PICKS record (G1-11)', () => {
    const row = (o: Record<string, unknown>) => ({
        date: '2026-10-05',
        homeTeam: 'Bruins',
        awayTeam: 'Rangers',
        predictedWinner: 'Bruins',
        isCorrect: true,
        homeWinProb: 60,
        modelVersion: 'v3',
        ...o,
    });

    it('counts versioned model picks only: no legacy rows, no coin flips, no retro rows', () => {
        const out = pickSummaries(
            [row({}), row({ modelVersion: null }), row({ homeWinProb: 50.3 }), row({ retro: true }), row({ date: '2026-04-01' })] as never,
            ['BOS'],
        );
        expect(out.BOS.pickedWin).toEqual([true]);
        expect(out.NYR).toBeUndefined();
    });
});

describe('goalie GSAx per start (G1-3)', () => {
    it('sums non-empty-net GSAx over his regular-season starts, rounded like the team page', () => {
        const g = (starter: string, xgane: number, ga: number, enga = 0, type = 2) => ({ starter, xga: xgane + 1, xgane, ga, enga, type }) as never;
        const r = goalieStartsGsax([g('Sergei Bobrovsky', 2.5, 3, 1), g('Sergei Bobrovsky', 1.004, 2), g('Other Guy', 3, 0), g('Sergei Bobrovsky', 9, 0, 0, 3)], 'Sergei Bobrovsky');
        expect(r.gs).toBe(2);
        // (2.5 - (3 - 1)) + (1.004 - 2) = -0.496 → -0.5
        expect(r.gsax).toBe(-0.5);
        expect(goalieStartsGsax([], 'Nobody')).toEqual({ starts: [], gs: 0, gsax: null });
    });
});
