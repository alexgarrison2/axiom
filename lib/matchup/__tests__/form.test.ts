import { describe, expect, it } from 'vitest';
import { buildEntries, fmtRecord, recentGames, recordOf, resultOf, startedBy, streakOf } from '../form';
import type { MatchupGame } from '../matchup-stats';
import { SEASON_ID } from '../../season';

const g = (id: string, date: string, result: string, starter = '', season = SEASON_ID): MatchupGame =>
    ({ row: { id, date, result, starter, season, type: 2 }, xgf5: 0, xga5: 0, toi5: 0, rest: 3 }) as unknown as MatchupGame;

describe('form', () => {
    const games = [g('1', '2026-10-01', 'RW', 'Knight'), g('2', '2026-10-03', 'OTL'), g('3', '2026-10-05', 'RL'), g('4', '2026-10-07', 'SOW'), g('5', '2026-10-09', 'RW')];

    it('takes games before tonight, newest first, never tonight itself', () => {
        const r = recentGames(games, '5', '2026-10-09', 3);
        expect(r.map(x => x.row.id)).toEqual(['4', '3', '2']);
        expect(recentGames(games, 'x', '2026-10-05').map(x => x.row.id)).toEqual(['2', '1']);
    });

    it('never reaches back into last season', () => {
        const mixed = [...games, g('0', '2026-04-10', 'RW', '', '20252026')];
        expect(recentGames(mixed, 'x', '2026-10-20').map(x => x.row.id)).not.toContain('0');
    });

    it('maps result codes and counts a record', () => {
        expect(resultOf('SOW')).toEqual({ outcome: 'W', extra: 'SO' });
        expect(resultOf('OTL').outcome).toBe('OTL');
        expect(fmtRecord(recordOf(games))).toBe('3-1-1');
    });

    it('finds the current streak', () => {
        expect(streakOf([games[4], games[3], games[2]])).toEqual({ outcome: 'W', n: 2 });
        expect(streakOf([])).toBeNull();
    });

    it('matches the projected starter by name', () => {
        expect(startedBy(games[0], 'Knight')).toBe(true);
        expect(startedBy(games[1], 'Knight')).toBe(false);
        expect(startedBy(games[0], null)).toBe(false);
    });

    it("adds a game the log has not caught up with from the slate's recent list, and never doubles one it has", () => {
        const log = [g('1', '2026-10-01', 'RW')];
        const recent = [
            { date: '10/02', gameDate: '2026-10-02', gameId: 2, opponent: 'NSH', isHome: false, score: '2-3', result: 'O' },
            { date: '10/01', gameDate: '2026-10-01', gameId: 1, opponent: 'ZZZ', isHome: true, score: '4-1', result: 'W' },
        ];
        const e = buildEntries(log, recent, 'x', '2026-10-03', 5);
        expect(e.map(x => x.key)).toEqual(['2', '1']);
        expect(e[0]).toMatchObject({ outcome: 'OTL', extra: 'OT', gf: 2, ga: 3, game: null });
        expect(e[1].game).not.toBeNull();
        expect(buildEntries([], [], 'x', '2026-10-03', 5)).toEqual([]);
    });
});
