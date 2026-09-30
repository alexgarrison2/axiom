import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE, readableTextOn } from '../color';
import { clashSafePair, MIN_TEAM_DELTA_E, TEAM_CODES, TEAM_NAMES, TEAM_PALETTE, teamTextColor } from '../team-color';

describe('team palette', () => {
    it('covers all 32 clubs with names', () => {
        expect(TEAM_CODES).toHaveLength(32);
        for (const tri of TEAM_CODES) expect(TEAM_NAMES[tri]).toBeDefined();
    });

    it('text on every team colour (primary and alt) is at least 4.5:1', () => {
        for (const tri of TEAM_CODES) {
            for (const which of ['primary', 'alt'] as const) {
                const bg = TEAM_PALETTE[tri][which];
                const ink = teamTextColor(tri, which);
                expect(contrastRatio(bg, ink), `${tri} ${which} ${bg}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it("each club's alt is clearly different from its primary", () => {
        for (const tri of TEAM_CODES) {
            const { primary, alt } = TEAM_PALETTE[tri];
            expect(deltaE(primary, alt), tri).toBeGreaterThanOrEqual(MIN_TEAM_DELTA_E);
        }
    });
});

describe('WinBar clash logic (clashSafePair)', () => {
    it('CAR vs FLA (both red) picks distinct colours', () => {
        expect(deltaE(TEAM_PALETTE.CAR.primary, TEAM_PALETTE.FLA.primary)).toBeLessThan(MIN_TEAM_DELTA_E);
        const pair = clashSafePair('FLA', 'CAR');
        expect(pair.deltaE).toBeGreaterThanOrEqual(25);
        expect(deltaE(pair.away, pair.home)).toBeGreaterThanOrEqual(25);
        expect(pair.away).not.toBe(pair.home);
    });

    it('keeps both primaries when they are already distinct', () => {
        const pair = clashSafePair('EDM', 'VAN');
        expect(pair.awayVariant).toBe('primary');
        expect(pair.homeVariant).toBe('primary');
    });

    it('every one of the 992 ordered matchups gets ΔE ≥ 25', () => {
        const failures: string[] = [];
        for (const a of TEAM_CODES) {
            for (const h of TEAM_CODES) {
                if (a === h) continue;
                const pair = clashSafePair(a, h);
                if (pair.deltaE < MIN_TEAM_DELTA_E) failures.push(`${a}@${h} ${pair.deltaE.toFixed(1)}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('readableTextOn picks the higher-contrast ink', () => {
        expect(readableTextOn('#FFFFFF')).toBe('#05070B');
        expect(readableTextOn('#000000')).toBe('#FFFFFF');
    });
});
