import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../ui/color';
import { fmtProb, fmtSimPct, pctToneLch, plural, signed } from './format';

/** OKLCH → sRGB hex (for the contrast check). */
function oklchToHex({ l, c, h }: { l: number; c: number; h: number }): string {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
    const rgb = [
        4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
        -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
        -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
    ].map(v => {
        const x = Math.min(1, Math.max(0, v));
        const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(g * 255).toString(16).padStart(2, '0');
    });
    return `#${rgb.join('')}`;
}

describe('format', () => {
    it('never prints hard 0% / 100% for simulated odds', () => {
        expect(fmtSimPct(0)).toBe('<0.1%');
        expect(fmtSimPct(100)).toBe('>99.9%');
        expect(fmtSimPct(0.4)).toBe('0.4%');
        expect(fmtSimPct(62.04)).toBe('62%');
        expect(fmtSimPct(null)).toBe('—');
    });

    it('formats signs, probabilities and plurals', () => {
        expect(signed(3.21)).toBe('+3.2');
        expect(signed(-1.06)).toBe('−1.1');
        expect(signed(0.01)).toBe('±0.0');
        expect(fmtProb(0.634)).toBe('63%');
        expect(plural(1, 'game')).toBe('1 game');
        expect(plural(2, 'game')).toBe('2 games');
    });

    it('percentage tones stay ≥4.5:1 on every dark surface', () => {
        for (let p = 0; p <= 100; p += 5) {
            const hex = oklchToHex(pctToneLch(p));
            for (const bg of ['#05070b', '#0b0f16', '#111723', '#151c2b']) {
                expect(contrastRatio(hex, bg), `${p}% ${hex} on ${bg}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
});
