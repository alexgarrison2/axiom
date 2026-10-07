import { describe, expect, it } from 'vitest';
import { ARENAS, haversineMi, venueFor } from '../arenas';
import {
    buildLeagueSchedules,
    compareToLeague,
    extremeStretch,
    mergeWindows,
    peakWindow,
    restDays,
    rollingMean,
    windowEnds,
    type RawGame,
} from '../metrics';
import { clockLabel, dayNumber, localHour, utcOffsetHours, zoneLabel } from '../time';

const days = (dates: string[]) => dates.map(dayNumber);

/** A game at 7 PM local in the home arena's zone (UTC start given directly). */
let nextId = 2026020001;
function game(date: string, startUtc: string, away: string, home: string, extra: Partial<RawGame> = {}): RawGame {
    return { id: nextId++, type: 2, date, start: startUtc, home, away, venue: ARENAS[home].name, tz: ARENAS[home].tz, neutral: false, event: null, state: 'FUT', ...extra };
}

describe('rest and density windows', () => {
    const d = days(['2026-10-10', '2026-10-11', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-20']);

    it('counts days off before each game', () => {
        expect(restDays(d)).toEqual([null, 0, 1, 0, 0, 4]);
    });

    it('finds back-to-backs as two games in two days', () => {
        expect(windowEnds(d, 2, 2)).toEqual([1, 3, 4]);
    });

    it('finds 3-in-4, 4-in-6 and 5-in-8 windows by their last game', () => {
        expect(windowEnds(d, 3, 4)).toEqual([2, 3, 4]); // 10-13 (3 in 4 days), 11-14, 13-15
        expect(windowEnds(d, 4, 6)).toEqual([3, 4]); // 10-14 (4 in 5 days), 11-15
        expect(windowEnds(d, 5, 8)).toEqual([4]); // 10-15
    });

    it('does not count 3 games in 5 days as a 3-in-4', () => {
        expect(windowEnds(days(['2026-11-01', '2026-11-03', '2026-11-05']), 3, 4)).toEqual([]);
    });

    it('merges overlapping windows into bands', () => {
        expect(mergeWindows([2, 3, 4], 3)).toEqual([[0, 4]]);
        expect(mergeWindows([2, 7], 3)).toEqual([
            [0, 2],
            [5, 7],
        ]);
    });
});

describe('distances', () => {
    it('measures great-circle miles between arenas', () => {
        // Madison Square Garden to TD Garden is about 190 miles as the crow flies.
        expect(haversineMi(ARENAS.NYR, ARENAS.BOS)).toBeGreaterThan(180);
        expect(haversineMi(ARENAS.NYR, ARENAS.BOS)).toBeLessThan(200);
        // Coast to coast: Rogers Arena to Amerant Bank Arena, ~2,800 miles.
        expect(haversineMi(ARENAS.VAN, ARENAS.FLA)).toBeGreaterThan(2700);
        expect(haversineMi(ARENAS.VAN, ARENAS.FLA)).toBeLessThan(2900);
        expect(haversineMi(ARENAS.DAL, ARENAS.DAL)).toBe(0);
    });

    it('resolves special venues by name and falls back to the home arena', () => {
        const wc = venueFor('loanDepot park', 'FLA', 'America/New_York');
        expect(wc.outdoor).toBe(true);
        expect(wc.city).toBe('Miami');
        const stockholm = venueFor('Avicii Arena', 'NSH', 'Europe/Stockholm');
        expect(stockholm.abroad).toBe(true);
        expect(venueFor('American Airlines Center', 'DAL').key).toBe('DAL');
        const unknown = venueFor('Some New Arena', 'DAL', 'America/Chicago');
        expect(unknown.approx).toBe(true);
        expect(unknown.lat).toBe(ARENAS.DAL.lat);
    });
});

describe('time zones and body clock', () => {
    const start = new Date('2026-11-14T03:00:00Z'); // 7 PM PST = 10 PM EST

    it('reads offsets and wall-clock hours', () => {
        expect(utcOffsetHours('America/Los_Angeles', start)).toBe(-8);
        expect(utcOffsetHours('America/New_York', start)).toBe(-5);
        expect(utcOffsetHours('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(-4);
        expect(localHour('America/Los_Angeles', start)).toBe(19);
        expect(localHour('America/New_York', start)).toBe(22);
        expect(clockLabel('America/New_York', start)).toBe('10:00 PM');
        expect(zoneLabel('America/Los_Angeles', start)).toBe('PT');
        expect(zoneLabel('Europe/Stockholm', start)).toBe('CET');
    });
});

describe('rolling difficulty helpers', () => {
    it('averages a centred window that shrinks at the ends', () => {
        expect(rollingMean([0, 10, 20, 30, 40], 3)).toEqual([5, 10, 20, 30, 35]);
    });
    it('finds the toughest and softest stretch', () => {
        expect(extremeStretch([1, 9, 9, 1, 1], 2, 'max')).toEqual({ first: 1, last: 2, diff: 9 });
        expect(extremeStretch([5, 9, 9, 1, 1], 2, 'min')).toEqual({ first: 3, last: 4, diff: 1 });
        expect(extremeStretch([1], 2, 'max')).toBeNull();
    });
    it('sums the busiest 7-day window', () => {
        const p = peakWindow(
            [
                { day: 1, value: 100 },
                { day: 3, value: 200 },
                { day: 7, value: 300 },
                { day: 8, value: 50 },
            ],
            7,
        );
        expect(p).toEqual({ value: 600, first: 1, last: 7 });
    });
});

describe('a team season end to end', () => {
    // BOS: home, at VAN (7 PM PT), at SEA next night, at LAK, 4 days off, at ANA, home.
    nextId = 2026020001;
    const raw: RawGame[] = [
        game('2026-11-01', '2026-11-01T23:00:00Z', 'NYR', 'BOS'),
        game('2026-11-04', '2026-11-05T03:00:00Z', 'BOS', 'VAN'),
        game('2026-11-05', '2026-11-06T03:00:00Z', 'BOS', 'SEA'),
        game('2026-11-07', '2026-11-08T03:00:00Z', 'BOS', 'LAK'),
        game('2026-11-12', '2026-11-13T03:00:00Z', 'BOS', 'ANA'),
        game('2026-11-15', '2026-11-16T00:00:00Z', 'TOR', 'BOS'),
        // Opponents' other games, for their rest.
        game('2026-11-04', '2026-11-05T03:00:00Z', 'CGY', 'SEA', { id: 1 }),
        game('2026-11-06', '2026-11-07T03:00:00Z', 'EDM', 'LAK', { id: 2 }),
        game('2026-11-14', '2026-11-15T00:00:00Z', 'TOR', 'MTL', { id: 3 }),
    ];
    const all = buildLeagueSchedules(raw, { strength: { VAN: 1, SEA: -1, LAK: 0.5 } });
    const bos = all.get('BOS')!;
    const g = bos.games;

    it('keeps only the team’s games in order', () => {
        expect(g.map(x => x.opp)).toEqual(['NYR', 'VAN', 'SEA', 'LAK', 'ANA', 'TOR']);
        expect(g.map(x => x.home)).toEqual([true, false, false, false, false, true]);
    });

    it('flags the back-to-back and the opponent’s rest', () => {
        expect(g[2].b2b).toBe(true);
        expect(g[2].oppRest).toBe(0); // SEA also played the night before
        expect(g[2].tags).toContain('B2B');
        expect(g[2].tags).not.toContain('REST-'); // both sides on a back-to-back
        expect(g[3].oppB2b).toBe(true); // LAK played the 6th
        expect(g[3].tags).toContain('REST+');
        expect(g[5].oppB2b).toBe(true);
        expect(bos.summary.b2b).toBe(1);
        expect(bos.summary.b2bRoad).toBe(1);
    });

    it('reads the body clock of an Eastern team out West', () => {
        expect(g[1].local).toBe('7:00 PM');
        expect(g[1].localTz).toBe('PT');
        expect(g[1].body).toBe('10:00 PM');
        expect(g[1].tzDelta).toBe(-3);
        expect(g[1].tzShift).toBe(-3);
        expect(g[1].tags).toEqual(expect.arrayContaining(['LATE', 'TZ']));
        expect(g[2].tzShift).toBe(0);
        expect(g[5].tzShift).toBe(3);
    });

    it('builds road trips and flies home across a long break', () => {
        // VAN-SEA-LAK is one trip; 4 days off before ANA sends the team home, so ANA is a second trip.
        expect(bos.trips.map(t => [t.first, t.last, t.games])).toEqual([
            [1, 3, 3],
            [4, 4, 1],
        ]);
        const legs = bos.legs.map(l => `${l.from.key}>${l.to.key}`);
        expect(legs).toEqual(['BOS>VAN', 'VAN>SEA', 'SEA>LAK', 'LAK>BOS', 'BOS>ANA', 'ANA>BOS']);
        const trip1 = bos.trips[0];
        const expected = haversineMi(ARENAS.BOS, ARENAS.VAN) + haversineMi(ARENAS.VAN, ARENAS.SEA) + haversineMi(ARENAS.SEA, ARENAS.LAK) + haversineMi(ARENAS.LAK, ARENAS.BOS);
        expect(trip1.mi).toBeCloseTo(expected, 6);
        expect(bos.summary.mi).toBeCloseTo(
            bos.legs.reduce((s, l) => s + l.mi, 0),
            6,
        );
        // Miles into the ANA game include the flight home first.
        expect(g[4].mi).toBeCloseTo(haversineMi(ARENAS.LAK, ARENAS.BOS) + haversineMi(ARENAS.BOS, ARENAS.ANA), 6);
        expect(bos.summary.longestTrip?.games).toBe(3);
        expect(bos.breaks).toEqual([{ after: 3, days: 4 }]);
    });

    it('rates difficulty by opponent, venue and rest', () => {
        // VAN (strong, road) is harder than SEA (weak, road, both on a back-to-back).
        expect(g[1].diff).toBeGreaterThan(g[2].diff);
        // The same opponent strength at home is easier than on the road.
        expect(g[0].diff).toBeLessThan(50);
        expect(g[1].oppRank).toBe(1);
    });

    it('compares against the league', () => {
        const cmp = compareToLeague(all, 'BOS');
        expect(cmp.mi.rank).toBe(1);
        expect(cmp.mi.of).toBe(all.size);
        expect(cmp.b2b.value).toBe(1);
    });
});

describe('special events', () => {
    it('tags outdoor and Global Series games and treats a nearby outdoor home game as home', () => {
        nextId = 2025020001;
        const raw: RawGame[] = [
            game('2026-01-02', '2026-01-03T01:00:00Z', 'NYR', 'FLA', { venue: 'loanDepot park', neutral: true, event: 'Discover Winter Classic' }),
            game('2025-11-14', '2025-11-14T18:00:00Z', 'PIT', 'NSH', { venue: 'Avicii Arena', tz: 'Europe/Stockholm', neutral: true, event: ' Global Series' }),
        ];
        const all = buildLeagueSchedules(raw);
        const fla = all.get('FLA')!.games[0];
        expect(fla.event).toEqual({ kind: 'outdoor', name: 'Winter Classic' });
        expect(fla.onRoad).toBe(false);
        expect(fla.tags).toContain('OUTDOOR');
        const nsh = all.get('NSH')!.games[0];
        expect(nsh.event?.kind).toBe('global');
        expect(nsh.onRoad).toBe(true); // a "home" game in Stockholm is still a trip
        expect(nsh.local).toBe('7:00 PM');
        expect(nsh.localTz).toBe('CET');
        expect(nsh.tags).toEqual(expect.arrayContaining(['GLOBAL', 'EARLY']));
        expect(all.get('NSH')!.summary.mi).toBeGreaterThan(9000);
    });
});
