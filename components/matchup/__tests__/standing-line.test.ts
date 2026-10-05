import { describe, expect, it } from 'vitest';
import { standingLine } from '../MatchupPanel';

describe('standingLine', () => {
    it('reads record, standings points and division place', () => {
        expect(standingLine({ record: '3-1-0', points: 6, divRank: 1, division: 'Metropolitan' })).toEqual(['3-1-0', '(6 pts)', '1st Metro']);
        expect(standingLine({ record: '1-2-1', points: 3, divRank: 6, division: 'Central' })).toEqual(['1-2-1', '(3 pts)', '6th Central']);
    });

    it('derives points from the record and drops the place when the NHL feed is unavailable', () => {
        expect(standingLine({ record: '2-0-1', points: null, divRank: null, division: null })).toEqual(['2-0-1', '(5 pts)']);
        expect(standingLine({ record: null, points: null, divRank: null, division: null })).toBeNull();
    });
});
