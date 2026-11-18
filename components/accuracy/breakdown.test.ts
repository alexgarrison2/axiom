import { describe, expect, it } from 'vitest';
import { breakdown, sortBreakdown } from './breakdown';
import { playedIndex } from './filters';
import type { GradedGame } from './types';

const game = (o: Partial<GradedGame>): GradedGame => ({
    id: 1,
    date: '2026-10-01',
    season: '2026-27',
    type: '02',
    home: 'EDM',
    away: 'VAN',
    homeScore: 3,
    awayScore: 2,
    decision: 'REG',
    homeProb: 60,
    marketProb: 55,
    homeXg: 3.1,
    awayXg: 2.4,
    brier: 0.16,
    logLoss: 0.51,
    retro: false,
    snapshotUtc: null,
    pickPrice: -120,
    homeGoalie: 'Devon Levi',
    awayGoalie: 'Thatcher Demko',
    ...o,
});

// Thu Oct 1: EDM (pick, fav) beats VAN. Fri Oct 2: EDM at BOS, model picks road EDM (a dog) and misses in OT.
// Sat Oct 3: TOR-BOS coin flip. Sun Nov 1: VAN (pick, 70%) beats CGY with no real price.
const games = [
    game({ id: 1 }),
    game({ id: 2, date: '2026-10-02', home: 'BOS', away: 'EDM', homeProb: 42, marketProb: 58, decision: 'OT', homeGoalie: 'Jeremy Swayman', awayGoalie: 'Tristan Jarry' }),
    game({ id: 3, date: '2026-10-03', home: 'TOR', away: 'BOS', homeProb: 50.3, homeGoalie: 'Joseph Woll', awayGoalie: 'Jeremy Swayman' }),
    game({ id: 4, date: '2026-11-01', home: 'VAN', away: 'CGY', homeProb: 70, marketProb: null, pickPrice: null, homeGoalie: 'Thatcher Demko', awayGoalie: 'Dustin Wolf' }),
];
const played = playedIndex(games);
const table = (view: Parameters<typeof breakdown>[1]) => breakdown(games, view, played).map(r => [r.label, r.summary.hits, r.summary.picks]);

describe('breakdown', () => {
    it('by team: every game a club played, alphabetical, clubs with no pick dropped', () => {
        expect(table('team')).toEqual([
            ['BOS', 0, 1],
            ['CGY', 1, 1],
            ['EDM', 1, 2],
            ['VAN', 2, 2],
        ]);
        // BOS's coin flip still counts toward its log loss.
        expect(breakdown(games, 'team', played)[0].summary.n).toBe(2);
    });

    it('by goalie: one row per starter with the club for its crest, teammates together', () => {
        const rows = breakdown(games, 'goalie', played);
        expect(rows.map(r => [r.tri, r.label, r.summary.hits, r.summary.picks])).toEqual([
            ['BOS', 'Jeremy Swayman', 0, 1],
            ['CGY', 'Dustin Wolf', 1, 1],
            ['EDM', 'Devon Levi', 1, 1],
            ['EDM', 'Tristan Jarry', 0, 1],
            ['VAN', 'Thatcher Demko', 2, 2],
        ]);
    });

    it('by the pick: venue, favourite or underdog, confidence tier and rest leave coin flips out', () => {
        expect(table('venue')).toEqual([
            ['Home pick', 2, 2],
            ['Road pick', 0, 1],
        ]);
        // Game 4 has no real price: neither favourite nor underdog.
        expect(table('role')).toEqual([
            ['Fav pick', 1, 1],
            ['Dog pick', 0, 1],
        ]);
        expect(table('confidence')).toEqual([
            ['55–60%', 0, 1],
            ['60–65%', 1, 1],
            ['65+%', 1, 1],
        ]);
        // Oct 2: the picked EDM played the day before, BOS did not.
        expect(table('rest')).toEqual([
            ['Pick B2B', 0, 1],
            ['Rested', 2, 2],
        ]);
    });

    it('by calendar and game shape: weekday from Monday, newest month first, finish, division and matchup', () => {
        expect(table('weekday')).toEqual([
            ['Thu', 1, 1],
            ['Fri', 0, 1],
            ['Sun', 1, 1],
        ]);
        expect(table('month')).toEqual([
            ['Nov 2026', 1, 1],
            ['Oct 2026', 1, 2],
        ]);
        expect(table('decision')).toEqual([
            ['Regulation', 2, 2],
            ['Overtime', 0, 1],
        ]);
        // A cross-division game counts for both divisions.
        expect(table('division')).toEqual([
            ['Atlantic', 0, 1],
            ['Pacific', 2, 3],
        ]);
        expect(table('matchup')).toEqual([
            ['Division', 2, 2],
            ['Inter-conference', 0, 1],
        ]);
    });
});

describe('sortBreakdown', () => {
    it('sorts rows by a column, rows with no value last either way', () => {
        const rows = breakdown(games, 'team', played);
        expect(sortBreakdown(rows, 'right', 'desc').map(r => r.label)).toEqual(['CGY', 'VAN', 'EDM', 'BOS']);
        expect(sortBreakdown(rows, 'games', 'asc').map(r => r.label)).toEqual(['BOS', 'CGY', 'EDM', 'VAN']);
        // CGY's only game has no price: no units, last in both directions.
        expect(sortBreakdown(rows, 'units', 'desc').at(-1)?.label).toBe('CGY');
        expect(sortBreakdown(rows, 'units', 'asc').at(-1)?.label).toBe('CGY');
        // Every goalie in one list: the best starter to back, whatever the club.
        expect(sortBreakdown(breakdown(games, 'goalie', played), 'units', 'desc')[0].label).toBe('Devon Levi');
    });
});
