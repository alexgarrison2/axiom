import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { matchupNews, pickSummaries } = await import('../details-server');
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

describe('matchup news', () => {
    const item = (player: string, timestamp: string, category = 'Injury') => ({ player, news: `${player} note`, category, date: timestamp.slice(0, 10), timestamp });
    const start = '2026-10-29T23:00:00Z';

    it('keeps the newest note per player from the week before puck drop, newest first', () => {
        const out = matchupNews(
            [
                item('Owen Beck', '2026-10-27T17:00:00Z'),
                item('Owen Beck', '2026-10-25T17:00:00Z'),
                item('Sam Steel', '2026-10-28T16:00:00Z'),
                item('Ivan Demidov', '2026-09-29T22:00:00Z'),
                item('Matt Duchene', '2026-10-12T16:00:00Z'),
            ],
            start,
        );
        expect(out.map(n => `${n.player} ${n.timestamp}`)).toEqual(['Sam Steel 2026-10-28T16:00:00Z', 'Owen Beck 2026-10-27T17:00:00Z']);
    });

    it('leaves out goalie-start notes and falls back to the date without a timestamp', () => {
        const out = matchupNews(
            [
                item('Jake Oettinger', '2026-10-29T15:00:00Z', 'Goalie Start'),
                { player: 'Roope Hintz', news: 'Hintz note', category: 'Injury', date: '2026-10-24' },
                { player: 'Esa Lindell', news: 'Lindell note', category: 'Injury', date: '2026-10-20' },
            ],
            start,
        );
        expect(out.map(n => n.player)).toEqual(['Roope Hintz']);
    });
});
