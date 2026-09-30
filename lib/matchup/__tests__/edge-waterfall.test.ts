import { describe, expect, it } from 'vitest';
import { gateClosedSiteWide, gatedEdge, hasMarket, marketPair, modelPair, pickForm } from '../edge';
import { buildWaterfall, waterfallFor } from '../waterfall';
import { fixture, withOverrides } from './fixtures';

const all = [...fixture('opening_night'), ...fixture('week3'), ...fixture('playoffs')];

describe('model vs market (E4)', () => {
    it('shows both Model % and Market % on every card with odds, each pair summing to 100', () => {
        for (const p of all.filter(hasMarket)) {
            const m = modelPair(p);
            const mk = marketPair(p);
            if (!m) continue; // no_pregame_prediction rows have no model
            expect(mk).not.toBeNull();
            expect(m.away + m.home).toBe(100);
            expect(mk!.away + mk!.home).toBe(100);
        }
    });

    it('never shows units when the data has none (every fixture row)', () => {
        for (const p of all) {
            expect(p.units).toBeNull();
            expect(gatedEdge(p)?.units ?? null).toBeNull();
        }
    });

    it('shows an edge only when ev_gated is true, naming its side', () => {
        const p = all.find(x => hasMarket(x) && modelPair(x))!;
        expect(gatedEdge(p)).toBeNull();
        const open = withOverrides(p, { evGated: true, betSide: 'home', units: 1.2 }, { home: { ev: 0.041 } });
        expect(gatedEdge(open)).toEqual({ side: 'home', tri: p.home.team.triCode, evPct: 4.1, units: 1.2 });
        const noUnits = withOverrides(open, { units: null });
        expect(gatedEdge(noUnits)?.units).toBeNull();
    });

    it('reports the gate closed site-wide when no game is gated', () => {
        expect(gateClosedSiteWide(fixture('opening_night'))).toBe(true);
        const [p, ...rest] = fixture('week3');
        expect(gateClosedSiteWide([withOverrides(p, { evGated: true }), ...rest])).toBe(false);
    });

    it('gates the pick-form % at 3 picks', () => {
        expect(pickForm([true, false])).toEqual({ w: 1, l: 1, pct: null });
        expect(pickForm([true, false, true])).toEqual({ w: 2, l: 1, pct: 67 });
    });
});

describe('why this pick (E5)', () => {
    it('reconciles the waterfall with the published home win % within 0.1pt on every fixture row', () => {
        let checked = 0;
        for (const p of all) {
            const w = waterfallFor(p);
            if (!w || p.home.winPct == null) continue;
            expect(Math.abs(w.end - p.home.winPct)).toBeLessThanOrEqual(0.1);
            expect(w.min).toBeLessThanOrEqual(50);
            expect(w.max).toBeGreaterThanOrEqual(50);
            checked++;
        }
        expect(checked).toBeGreaterThan(5);
    });

    it('chains each factor from 50%', () => {
        const w = buildWaterfall([
            { factor: 'home_ice', label: 'Home ice', wp_delta_pts: 2 },
            { factor: 'goaltending', label: 'Goaltending', wp_delta_pts: -5 },
        ])!;
        expect(w.steps.map(s => [s.from, s.to])).toEqual([
            [50, 52],
            [52, 47],
        ]);
        expect(w.end).toBe(47);
    });
});

describe('forecast vs model-only pairs', () => {
    it('forecastPair is the blended win %, modelOnlyPair the pure model, each summing to 100', async () => {
        const { forecastPair, modelOnlyPair, blendNote } = await import('../edge');
        const base = all.find(x => hasMarket(x) && forecastPair(x))!;
        const p = {
            ...base,
            blendWeight: 0.2,
            away: { ...base.away, winPct: 48.6, modelWinPct: 61.1 },
            home: { ...base.home, winPct: 51.4, modelWinPct: 38.9 },
        };
        expect(forecastPair(p)).toEqual({ away: 49, home: 51 });
        expect(modelOnlyPair(p)).toEqual({ away: 61, home: 39 });
        expect(modelPair(p)).toEqual(forecastPair(p));
        expect(blendNote(p)).toMatch(/model 20%, market 80%/);
        expect(modelOnlyPair({ ...p, away: { ...p.away, modelWinPct: null }, home: { ...p.home, modelWinPct: null } })).toBeNull();
    });
});
