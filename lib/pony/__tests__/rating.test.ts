import { describe, expect, it } from 'vitest';
import PONY from '@/public/data/pony_score.json';
import { ponyRating, ponyTier, ratingPos } from '../rating';

const A = (PONY as unknown as { rating: { value: number[]; F: number[]; D: number[]; G: number[] } }).rating;

describe('Pony Rating', () => {
    it('reads each anchor as its rating, per position', () => {
        for (const p of ['F', 'D', 'G'] as const) {
            A[p].forEach((x, i) => expect(ponyRating(x, p)).toBe(A.value[i]));
        }
    });

    it('clamps to 0-10 and rises with the score', () => {
        expect(ponyRating(-99, 'F')).toBe(0);
        expect(ponyRating(99, 'D')).toBe(10);
        let prev = -1;
        for (let s = -1; s <= 3; s += 0.05) {
            const r = ponyRating(s, 'C');
            expect(r).toBeGreaterThanOrEqual(prev);
            prev = r;
        }
    });

    it('grades a defenceman against defencemen', () => {
        expect(ponyRating(0.8, 'D')).toBeGreaterThan(ponyRating(0.8, 'F'));
        expect(ratingPos('L')).toBe('F');
        expect(ratingPos('G')).toBe('G');
    });

    it('takes the tier from the shown figure', () => {
        expect(ponyTier(9).label).toBe('Incredible');
        expect(ponyTier(7.5).label).toBe('Great');
        expect(ponyTier(7.4).label).toBe('Good');
        expect(ponyTier(5).label).toBe('Average');
        expect(ponyTier(2.5).label).toBe('Below avg');
        expect(ponyTier(2.4).label).toBe('Horrible');
    });
});
