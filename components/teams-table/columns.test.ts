import { describe, expect, it } from 'vitest';
import { COLUMN_BY_KEY, emphasisMap } from './columns';

const e = (vals: number[]) => vals.map((v, i) => [`T${i}`, v] as const);

describe('emphasisMap', () => {
    it('marks up to five best and five worst', () => {
        const m = emphasisMap(e([...Array(32).keys()]), 'high');
        expect([...m].filter(([, x]) => x === 'hi').map(([t]) => t)).toEqual(['T31', 'T30', 'T29', 'T28', 'T27']);
        expect([...m].filter(([, x]) => x === 'lo')).toHaveLength(5);
        expect(m.get('T0')).toBe('lo');
    });
    it('flips for lower-is-better columns and skips neutral ones', () => {
        expect(emphasisMap(e([...Array(32).keys()]), 'low').get('T0')).toBe('hi');
        expect(emphasisMap(e([1, 2, 3]), 'none').size).toBe(0);
    });
    it('caps at a third of the teams', () => {
        expect([...emphasisMap(e([1, 2, 3, 4, 5, 6]), 'high').values()].filter(x => x === 'hi')).toHaveLength(2);
        expect(emphasisMap(e([1, 2]), 'high').size).toBe(0);
    });
    it('never marks values tied with the cut', () => {
        const zeros = [...Array(28).fill(0), 1, 1, 2, 3];
        const m = emphasisMap(e(zeros), 'high');
        expect([...m.values()].filter(x => x === 'hi')).toHaveLength(4);
        expect([...m.values()].filter(x => x === 'lo')).toHaveLength(0);
    });
});

describe('column flags', () => {
    it('treats tallies as counts and thin-samples the special-teams rates', () => {
        expect(COLUMN_BY_KEY.get('otmw')?.count).toBe(true);
        expect(COLUMN_BY_KEY.get('otml')?.count).toBe(true);
        expect(COLUMN_BY_KEY.get('pp_pct')?.thin?.({ pp_opps: 14 } as never)).toBe(true);
        expect(COLUMN_BY_KEY.get('pp_pct')?.thin?.({ pp_opps: 15 } as never)).toBe(false);
    });
});
