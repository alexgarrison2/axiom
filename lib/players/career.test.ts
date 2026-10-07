import { describe, expect, it } from 'vitest';
import { groupBySeason, seasonAge } from './career';

describe('seasonAge', () => {
    it('is the age on February 1 of the season', () => {
        expect(seasonAge('1995-09-01', 20152016)).toBe(20); // MacKinnon: 20 on 2016-02-01
        expect(seasonAge('1997-02-01', 20152016)).toBe(19); // birthday on the cutoff counts
        expect(seasonAge('1997-02-02', 20152016)).toBe(18);
        expect(seasonAge('1997-01-31', 20152016)).toBe(19);
    });
    it('handles missing input', () => {
        expect(seasonAge(null, 20152016)).toBeNull();
        expect(seasonAge('1997-01-31', 0)).toBeNull();
        expect(seasonAge('not a date', 20152016)).toBeNull();
    });
});

describe('groupBySeason', () => {
    const rows = [
        { season: 20142015, seq: 1, team: 'London' },
        { season: 20152016, seq: 3, team: 'M-Cup London' },
        { season: 20152016, seq: 1, team: 'London' },
        { season: 20152016, seq: 2, team: 'Canada U20' },
        { season: 20162017, seq: 1, team: 'Toronto' },
    ];
    it('orders newest season first, feed order within a season', () => {
        expect(groupBySeason(rows).map(r => r.line.team)).toEqual(['Toronto', 'London', 'Canada U20', 'M-Cup London', 'London']);
    });
    it('marks block edges and alternates the band per season', () => {
        const g = groupBySeason(rows);
        expect(g.map(r => r.first)).toEqual([true, true, false, false, true]);
        expect(g.map(r => r.last)).toEqual([true, false, false, true, true]);
        expect(g.map(r => r.band)).toEqual([0, 1, 1, 1, 0]);
    });
    it('keeps input order for equal keys', () => {
        const g = groupBySeason([
            { season: 1, team: 'a' },
            { season: 1, team: 'b' },
        ]);
        expect(g.map(r => r.line.team)).toEqual(['a', 'b']);
    });
});
