import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb } from '@/components/ui/color';
import { HEAT_BAD, HEAT_GOOD, HEAT_MAX_ALPHA, heatTint, leaguePercentile, sampleWeight } from './columns';

const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');
const token = (name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`token --${name} not found`);
    return m[1];
};
const hex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const alphaOf = (tint: string | undefined) => Number(tint?.match(/\/ ([\d.]+)\)/)?.[1] ?? 0);

describe('leaguePercentile', () => {
    const sorted = [1, 2, 3, 4, 5];
    it('maps lowest to 0, highest to 1, median to 0.5', () => {
        expect(leaguePercentile(1, sorted)).toBe(0);
        expect(leaguePercentile(5, sorted)).toBe(1);
        expect(leaguePercentile(3, sorted)).toBe(0.5);
    });
    it('gives tied values the same mid-rank', () => {
        expect(leaguePercentile(0, [0, 0, 1, 1])).toBeCloseTo(1 / 6);
        expect(leaguePercentile(1, [0, 0, 1, 1])).toBeCloseTo(5 / 6);
        expect(leaguePercentile(2, [2, 2, 2])).toBe(0.5);
    });
    it('is null without a value or a league to compare to', () => {
        expect(leaguePercentile(NaN, sorted)).toBeNull();
        expect(leaguePercentile(3, [3])).toBeNull();
    });
});

describe('heatTint', () => {
    it('is cyan for the best, orange for the worst, untinted in the middle', () => {
        expect(heatTint(1, 'high')).toBe(`rgb(${HEAT_GOOD.join(' ')} / ${HEAT_MAX_ALPHA.good})`);
        expect(heatTint(0, 'high')).toBe(`rgb(${HEAT_BAD.join(' ')} / ${HEAT_MAX_ALPHA.bad})`);
        expect(heatTint(0.5, 'high')).toBeUndefined();
        expect(heatTint(0.51, 'high')).toBeUndefined();
    });
    it('flips for lower-is-better columns and skips neutral ones', () => {
        expect(heatTint(0, 'low')).toContain(HEAT_GOOD.join(' '));
        expect(heatTint(1, 'low')).toContain(HEAT_BAD.join(' '));
        expect(heatTint(1, 'none')).toBeUndefined();
        expect(heatTint(null, 'high')).toBeUndefined();
    });
    it('scales with rank distance and sample weight', () => {
        expect(alphaOf(heatTint(0.9, 'high'))).toBeGreaterThan(alphaOf(heatTint(0.7, 'high')));
        expect(alphaOf(heatTint(1, 'high', 0.25))).toBeCloseTo(HEAT_MAX_ALPHA.good * 0.25);
    });
});

describe('sampleWeight', () => {
    it('is faint at 1 GP, full at 10, zero before a game', () => {
        expect(sampleWeight(0)).toBe(0);
        expect(sampleWeight(1)).toBeCloseTo(0.46);
        expect(sampleWeight(10)).toBe(1);
        expect(sampleWeight(40)).toBe(1);
    });
});

describe('tint legibility', () => {
    // The row states the tint sits on (CELL_BG): plain, zebra, hover.
    const surface = hexToRgb(token('surface-1'));
    const line = hexToRgb(token('line'));
    const rows = { plain: surface, zebra: mix(surface, line, 0.4), hover: mix(surface, line, 0.85) };
    it.each([
        ['good', HEAT_GOOD, HEAT_MAX_ALPHA.good],
        ['bad', HEAT_BAD, HEAT_MAX_ALPHA.bad],
    ] as const)('--text-1 stays well above AA (6:1) on the strongest %s tint in every row state', (_, color, alpha) => {
        for (const [state, bg] of Object.entries(rows)) {
            const cell = hex(mix(bg, [...color], alpha));
            expect(contrastRatio(token('text-1'), cell), `${state} ${cell}`).toBeGreaterThanOrEqual(6);
        }
    });
});
