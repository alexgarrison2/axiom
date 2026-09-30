import { describe, expect, it } from 'vitest';
import { archiveFinalLabel, buildArchive, slateHeading, validDate, type HistoryRow, type NhlScoreGame } from '../archive';
import { legacyTabDestination } from '../../legacy-tab';

const feed: NhlScoreGame[] = [
    { id: 2026020001, gameDate: '2026-09-29', startTimeUTC: '2026-09-29T23:00:00Z', gameState: 'OFF', gameOutcome: { lastPeriodType: 'OT' }, awayTeam: { abbrev: 'FLA', score: 1 }, homeTeam: { abbrev: 'CAR', score: 0 } },
    { id: 2026020004, gameDate: '2026-09-29', startTimeUTC: '2026-09-30T02:00:00Z', gameState: 'OFF', gameOutcome: { lastPeriodType: 'OT' }, awayTeam: { abbrev: 'VAN', score: 6 }, homeTeam: { abbrev: 'EDM', score: 5 } },
    { id: 2026020005, gameDate: '2026-09-29', startTimeUTC: '2026-09-30T02:30:00Z', gameState: 'OFF', gameOutcome: { lastPeriodType: 'REG' }, awayTeam: { abbrev: 'CHI', score: 2 }, homeTeam: { abbrev: 'VGK', score: 5 } },
];
const history: HistoryRow[] = [
    { gameId: 2026020004, date: '2026-09-29', homeTeam: 'Oilers', awayTeam: 'Canucks', homeScore: 5, awayScore: 6, decision: 'OT', homeWinProb: 71.9, isCorrect: false, retro: false },
    { gameId: 2026020005, date: '2026-09-29', homeTeam: 'Golden Knights', awayTeam: 'Blackhawks', homeScore: 5, awayScore: 2, decision: 'REG', homeWinProb: 75.1, isCorrect: true, retro: false },
];

describe('buildArchive', () => {
    it('joins finals with the graded pregame pick; games without one have pick null', () => {
        const s = buildArchive('2026-09-29', feed, history);
        expect(s.scheduleKnown).toBe(true);
        expect(s.games.map(g => `${g.away.tri}@${g.home.tri}`)).toEqual(['FLA@CAR', 'VAN@EDM', 'CHI@VGK']);
        const [fla, van, chi] = s.games;
        expect(fla.pick).toBeNull();
        expect(archiveFinalLabel(fla)).toBe('FINAL/OT');
        expect(van.pick).toEqual({ tri: 'EDM', pct: 72, correct: false });
        expect(chi.pick).toEqual({ tri: 'VGK', pct: 75, correct: true });
    });

    it('falls back to the history rows when the feed is down (and never claims "no games")', () => {
        const s = buildArchive('2026-09-29', null, history);
        expect(s.scheduleKnown).toBe(false);
        expect(s.games).toHaveLength(2);
        expect(s.games[0].home.tri).toBe('EDM');
        expect(buildArchive('2030-01-01', null, history)).toEqual({ date: '2030-01-01', games: [], scheduleKnown: false });
    });

    it('lists scheduled games with no pick for a future day', () => {
        const s = buildArchive('2026-10-02', [{ id: 2026020017, gameDate: '2026-10-02', startTimeUTC: '2026-10-02T22:30:00Z', gameState: 'FUT', awayTeam: { abbrev: 'NYR' }, homeTeam: { abbrev: 'DET' } }], []);
        expect(s.games[0]).toMatchObject({ state: 'FUT', pick: null, away: { tri: 'NYR', score: null } });
    });

    it('ignores retro (not pregame) history rows', () => {
        const s = buildArchive('2026-09-29', feed, [{ ...history[0], retro: true }]);
        expect(s.games.find(g => g.home.tri === 'EDM')!.pick).toBeNull();
    });
});

describe('validDate / legacy tabs', () => {
    it('round-trips dates through Date', () => {
        expect(validDate('2026-10-01')).toBe(true);
        expect(validDate('2026-02-30')).toBe(false);
        expect(validDate('10/01/2026')).toBe(false);
    });

    it('maps old ?tab= values case-insensitively and drops the param', () => {
        expect(legacyTabDestination('Teams')).toBe('/teams');
        expect(legacyTabDestination('NEWS')).toBe('/news');
        expect(legacyTabDestination('Playoffs')).toBe('/playoffs');
        expect(legacyTabDestination('history')).toBe('/accuracy');
        expect(legacyTabDestination('2026-10-01')).toBe('/?date=2026-10-01');
        expect(legacyTabDestination('2026-02-30')).toBe('/');
        expect(legacyTabDestination(null)).toBeNull();
    });
});

describe('slateHeading', () => {
    it('omits the year near today and adds it far away', () => {
        expect(slateHeading('2026-10-01', '2026-09-30')).toBe('Thu, Oct 1');
        expect(slateHeading('2030-01-01', '2026-09-30')).toBe('Tue, Jan 1, 2030');
    });
});
