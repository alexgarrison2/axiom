import { describe, expect, it } from 'vitest';
import { matches, NO_FILTER, playedIndex, weekday, type PickFilter } from './filters';
import type { GradedGame } from './types';

const game = (o: Partial<GradedGame>): GradedGame => ({
    id: 1,
    date: '2026-10-28', // a Wednesday
    season: '2026-27',
    type: '02',
    home: 'TOR',
    away: 'BOS',
    homeScore: 3,
    awayScore: 2,
    decision: 'REG',
    homeProb: 60,
    marketProb: 55,
    homeXg: 3,
    awayXg: 2.5,
    brier: 0.16,
    logLoss: 0.51,
    retro: false,
    snapshotUtc: null,
    ...o,
});
const f = (o: Partial<PickFilter>): PickFilter => ({ ...NO_FILTER, ...o });
const none = new Set<string>();

describe('who', () => {
    it('keeps a team on either side, a division on either side, and games inside one division', () => {
        expect(matches(game({}), f({ who: 'BOS' }), none)).toBe(true);
        expect(matches(game({}), f({ who: 'EDM' }), none)).toBe(false);
        expect(matches(game({ home: 'EDM', away: 'BOS' }), f({ who: 'div:Atlantic' }), none)).toBe(true);
        expect(matches(game({ home: 'EDM', away: 'DAL' }), f({ who: 'div:Atlantic' }), none)).toBe(false);
        expect(matches(game({}), f({ who: 'div:same' }), none)).toBe(true); // TOR and BOS, both Atlantic
        expect(matches(game({ away: 'NYR' }), f({ who: 'div:same' }), none)).toBe(false);
    });
});

describe('day', () => {
    it('reads the weekday off the local game date', () => {
        expect(weekday('2026-10-28')).toBe(3);
        expect(matches(game({}), f({ day: 3 }), none)).toBe(true);
        expect(matches(game({}), f({ day: 6 }), none)).toBe(false);
    });
});

describe('situations', () => {
    it('are about the pick without a team', () => {
        expect(matches(game({ homeProb: 60 }), f({ venue: 'home' }), none)).toBe(true);
        expect(matches(game({ homeProb: 40 }), f({ venue: 'home' }), none)).toBe(false);
        // The model picked BOS on the road while the market had TOR: the pick was the underdog.
        expect(matches(game({ homeProb: 45, marketProb: 58 }), f({ role: 'dog' }), none)).toBe(true);
        expect(matches(game({ homeProb: 45, marketProb: 58 }), f({ role: 'fav' }), none)).toBe(false);
    });
    it('are about the chosen team when one team is chosen', () => {
        // The model picked TOR, but BOS was on the road and the market's underdog.
        expect(matches(game({}), f({ who: 'BOS', venue: 'road', role: 'dog' }), none)).toBe(true);
        expect(matches(game({}), f({ who: 'BOS', venue: 'home' }), none)).toBe(false);
    });
    it('leave out coin flips (no pick), unpriced games for a market role, and a pick’em', () => {
        expect(matches(game({ homeProb: 50.4 }), f({ venue: 'home' }), none)).toBe(false);
        expect(matches(game({ marketProb: null }), f({ role: 'fav' }), none)).toBe(false);
        expect(matches(game({ placeholderOdds: true }), f({ role: 'fav' }), none)).toBe(false);
        expect(matches(game({ marketProb: 50 }), f({ role: 'fav' }), none)).toBe(false);
        expect(matches(game({ marketProb: 50 }), f({ role: 'dog' }), none)).toBe(false);
    });
    it('finds a back-to-back from the loaded games, across a month end', () => {
        const played = playedIndex([game({ id: 2, date: '2026-10-31', home: 'MTL', away: 'TOR' })]);
        expect(matches(game({ date: '2026-11-01' }), f({ b2b: true }), played)).toBe(true); // TOR picked, played Oct 31
        expect(matches(game({ date: '2026-11-01', homeProb: 40 }), f({ b2b: true }), played)).toBe(false); // BOS picked, rested
        expect(matches(game({ date: '2026-11-02' }), f({ b2b: true }), played)).toBe(false);
    });
});
