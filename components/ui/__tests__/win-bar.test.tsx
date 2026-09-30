import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WinBar, WinBarLegend, marketProbFromOdds, pctInk } from '../win-bar';
import { contrastRatio } from '../color';
import { TEAM_PALETTE } from '../team-color';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('marketProbFromOdds', () => {
    it('de-vigs American moneylines', () => {
        // +112 / -133: implied 0.4717 + 0.5708 → away 0.4525
        expect(marketProbFromOdds(112, -133)).toBeCloseTo(0.4525, 3);
        expect(marketProbFromOdds('-110', '-110')).toBeCloseTo(0.5, 6);
    });

    it('returns null for missing or zero prices', () => {
        expect(marketProbFromOdds(null, -133)).toBeNull();
        expect(marketProbFromOdds(112, undefined)).toBeNull();
        expect(marketProbFromOdds(0, -110)).toBeNull();
        expect(marketProbFromOdds('abc', -110)).toBeNull();
    });
});

describe('WinBar', () => {
    it('server HTML holds the final split and both percentages', () => {
        const out = html(<WinBar away="NYI" home="TOR" pAway={0.48} />);
        expect(out).toContain('width:48%');
        expect(out).toContain('width:52%');
        expect(out).toContain('--wb-to:48');
        expect(out).toContain('--wb-to:52');
        // No SSR opacity:0 (the grow-in is a CSS transform only)
        expect(out).not.toMatch(/opacity:\s*0[;"]/);
    });

    it('names market and model for screen readers and draws the tick and diamond only when given', () => {
        const bare = html(<WinBar away="NYI" home="TOR" pAway={0.48} />);
        expect(bare).toContain('aria-label="Win probability: NYI 48%, TOR 52%."');
        expect(bare).not.toContain('bg-magenta');
        expect(bare).not.toContain('bg-white');

        const full = html(<WinBar away="NYI" home="TOR" pAway={0.48} market={0.45} model={0.61} />);
        expect(full).toContain('Market: NYI 45%.');
        expect(full).toContain('Model: NYI 61%.');
        expect(full).toContain('left:45%');
        expect(full).toContain('left:61%');
        expect(full).toContain('bg-magenta');
    });

    it('desaturates the underdog and glows the favourite', () => {
        const out = html(<WinBar away="NYI" home="TOR" pAway={0.3} />);
        const fills = out.match(/<span aria-hidden="true" class="wb-fill[^>]*>/g) ?? [];
        expect(fills).toHaveLength(2);
        expect(fills[0]).toContain('saturate(.55)');
        expect(fills[0]).not.toContain('box-shadow');
        expect(fills[1]).toContain('box-shadow');
        expect(fills[1]).not.toContain('saturate(');
    });

    it('keeps tricodes out of the bar unless showCodes, but in sr-only text', () => {
        const out = html(<WinBar away="LAK" home="COL" pAway={0.36} />);
        expect(out).toContain('<span class="sr-only">LAK 36%</span>');
        expect(out).not.toContain('>LAK<');
        const coded = html(<WinBar away="LAK" home="COL" pAway={0.36} showCodes />);
        expect(coded).toContain('>LAK<');
        // Full-strength tricode (a faded one fell under AA on some fills).
        expect(coded).not.toContain('opacity-80');
    });

    it('labels a sliver below the bar and clamps out-of-range input', () => {
        const out = html(<WinBar away="CHI" home="VGK" pAway={0.08} size="md" />);
        expect(out).toContain('CHI 8%');
        const clamped = html(<WinBar away="CHI" home="VGK" pAway={1.7} />);
        expect(clamped).toContain('width:100%');
        expect(clamped).toContain('width:0%');
        const nan = html(<WinBar away="CHI" home="VGK" pAway={Number.NaN} />);
        expect(nan).toContain('width:50%');
    });

    it('dims only the fills on finals, never the % ink, and can skip the animation', () => {
        const out = html(<WinBar away="VAN" home="EDM" pAway={0.27} market={0.3} dimmed />);
        const fills = out.match(/<span aria-hidden="true" class="wb-fill[^>]*>/g) ?? [];
        expect(fills).toHaveLength(2);
        for (const f of fills) expect(f).toContain('opacity:0.55');
        expect(out).not.toContain('opacity-[.55]');
        // The % labels carry no opacity of their own.
        expect(out).not.toMatch(/style="color:[^"]*opacity/);
        expect(html(<WinBar away="VAN" home="EDM" pAway={0.27} animate={false} />)).not.toContain('wb-anim');
    });
});

describe('win-bar % contrast', () => {
    const colours = Object.entries(TEAM_PALETTE).flatMap(([tri, pal]) => [
        [tri, 'primary', pal.primary],
        [tri, 'alt', pal.alt],
    ]);

    it.each([false, true])('every team colour, favourite and underdog, keeps the %% at >=3:1 (dimmed=%s)', dimmed => {
        expect(colours).toHaveLength(64);
        for (const [tri, variant, hex] of colours) {
            for (const dog of [false, true]) {
                const { ink, backdrop } = pctInk(hex, dog, dimmed);
                // 26px bold italic is large text: 3:1 is the WCAG minimum.
                expect(contrastRatio(ink, backdrop), `${tri} ${variant} dog=${dog}`).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it('paints the ink picked against the faded fill on a dimmed bar', () => {
        // BOS gold as the dimmed favourite measured 2.72:1 when the whole bar faded.
        const out = html(<WinBar away="NYR" home="BOS" pAway={0.497} dimmed />);
        const { ink } = pctInk('#FFB81C', false, true);
        expect(out.toLowerCase()).toContain(`color:${ink.toLowerCase()}`);
    });

    it('shows one decimal for a coin flip when asked', () => {
        const out = html(<WinBar away="NYR" home="BOS" pAway={0.497} digits={1} dimmed />);
        expect(out).toContain('49.7');
        expect(out).toContain('50.3');
        expect(out).toContain('NYR 49.7%');
        expect(out).not.toContain('--wb-to');
    });
});

describe('WinBarLegend', () => {
    it('is the single MARKET / MODEL row', () => {
        const out = html(<WinBarLegend />);
        expect(out).toContain('Market');
        expect(out).toContain('Model');
        expect(html(<WinBarLegend model={false} />)).not.toContain('Model');
    });
});
