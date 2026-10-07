import { describe, expect, it } from 'vitest';
import { isoRings, levels, resample, ringArea, ringsPath } from './isolate-contour';
import { decodeCodes, density, isolateFor, ordinal, percentile, quantile, sgn, sgnPct, windowLabel, type IsolateDoc } from './isolate';

describe('resample', () => {
    it('spans the grid edges and clamps beyond the outer cell centres', () => {
        const lat = resample([1, 2, 3, 4], 2, 2, 2);
        expect(lat.nx).toBe(5);
        expect(lat.ny).toBe(5);
        // corners take the corner cells' values (clamped), the centre the mean
        expect(lat.v[0]).toBe(1);
        expect(lat.v[4]).toBe(2);
        expect(lat.v[4 * 5]).toBe(3);
        expect(lat.v[24]).toBe(4);
        expect(lat.v[2 * 5 + 2]).toBeCloseTo(2.5);
    });
});

describe('isoRings', () => {
    const peak = (nx: number, ny: number, ci: number, cj: number, s: number) =>
        Array.from({ length: nx * ny }, (_, k) => Math.exp(-(((Math.floor(k / ny) - ci) ** 2 + ((k % ny) - cj) ** 2) / (2 * s * s))));

    it('traces one closed ring around a single peak, shrinking with the level', () => {
        const lat = resample(peak(16, 17, 8, 8, 2), 16, 17, 4);
        const r1 = isoRings(lat, 0.3);
        const r2 = isoRings(lat, 0.7);
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(1);
        expect(ringArea(r1[0])).toBeGreaterThan(ringArea(r2[0]));
        // the ring encloses the peak's lattice position (8.5 cells * 4 = 34)
        const xs = r2[0].map(p => p[0]);
        const ys = r2[0].map(p => p[1]);
        expect(Math.min(...xs)).toBeLessThan(34);
        expect(Math.max(...xs)).toBeGreaterThan(34);
        expect(Math.min(...ys)).toBeLessThan(34);
        expect(Math.max(...ys)).toBeGreaterThan(34);
        // every vertex sits at the threshold (linear interpolation on the lattice)
        for (const [i, j] of r2[0]) {
            const i0 = Math.floor(i);
            const j0 = Math.floor(j);
            const fi = i - i0;
            const fj = j - j0;
            const v = (a: number, b: number) => lat.v[a * lat.ny + b];
            const val = fi > 0 ? v(i0, j0) * (1 - fi) + v(i0 + 1, j0) * fi : fj > 0 ? v(i0, j0) * (1 - fj) + v(i0, j0 + 1) * fj : v(i0, j0);
            expect(val).toBeCloseTo(0.7, 6);
        }
    });

    it('finds two rings for two separate peaks and none above the maximum', () => {
        const a = peak(16, 17, 4, 4, 1.5);
        const b = peak(16, 17, 12, 13, 1.5);
        const lat = resample(a.map((v, k) => v + b[k]), 16, 17, 3);
        expect(isoRings(lat, 0.5)).toHaveLength(2);
        expect(isoRings(lat, 5)).toHaveLength(0);
    });

    it('closes a region that runs into the grid edge', () => {
        const cells = Array.from({ length: 6 * 6 }, (_, k) => (Math.floor(k / 6) >= 4 ? 1 : 0));
        const rings = isoRings(resample(cells, 6, 6, 2), 0.5);
        expect(rings).toHaveLength(1);
        const p = ringsPath(rings, ([i, j]) => [j, i], 1);
        expect(p.startsWith('M')).toBe(true);
        expect(p.endsWith('Z')).toBe(true);
        // the ring reaches the far edge of the lattice (index 12)
        expect(Math.max(...rings[0].map(q => q[0]))).toBe(12);
    });

    it('keeps a hole as its own ring', () => {
        const cells = Array.from({ length: 9 * 9 }, (_, k) => {
            const i = Math.floor(k / 9);
            const j = k % 9;
            return Math.max(Math.abs(i - 4), Math.abs(j - 4)) === 2 ? 1 : 0;
        });
        expect(isoRings(resample(cells, 9, 9, 2), 0.5)).toHaveLength(2);
    });
});

describe('density', () => {
    it('peaks at the mode, is normalised to 1 and symmetric for symmetric data', () => {
        const d = density([-1, 0, 0, 0, 1], -2, 2, 41);
        expect(Math.max(...d)).toBe(1);
        expect(d.indexOf(1)).toBe(20);
        for (let i = 0; i < 41; i++) expect(d[i]).toBeCloseTo(d[40 - i], 9);
        expect(density([1], 0, 2, 5)).toEqual([0, 0, 0, 0, 0]);
    });
    it('interpolates quantiles', () => {
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        expect(quantile([0, 10], 0.25)).toBe(2.5);
    });
});

describe('levels', () => {
    it('spaces thresholds evenly up to the top', () => {
        expect(levels(100, 4)).toEqual([25, 50, 75, 100]);
    });
});

describe('formatting', () => {
    it('signs with a true minus and drops the sign at zero', () => {
        expect(sgn(0.4234)).toBe('+0.42');
        expect(sgn(-0.1)).toBe('−0.10');
        expect(sgn(-0.001)).toBe('0.00');
        expect(sgn(12.345, 1)).toBe('+12.3');
        expect(sgnPct(0.174)).toBe('+17%');
        expect(sgnPct(-0.04)).toBe('−4%');
        expect(sgnPct(0.004)).toBe('0%');
    });
    it('writes ordinals', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 100].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '100th']);
    });
    it('labels a window of seasons', () => {
        expect(windowLabel(['20242025', '20252026', '20262027'])).toBe('24-25 – 26-27');
        expect(windowLabel(['20252026'])).toBe('25-26');
    });
});

describe('data', () => {
    it('decodes int8 base64', () => {
        // bytes 0, 1, 127, 128 (-128), 255 (-1)
        expect(decodeCodes('AAF/gP8=')).toEqual([0, 1, 127, -128, -1]);
        expect(decodeCodes('')).toBeNull();
    });
    it('ranks with mid-rank ties', () => {
        expect(percentile([1, 2, 3, 4], 4)).toBe(88);
        expect(percentile([1, 2, 3, 4], 0)).toBe(0);
        expect(percentile([2, 2], 2)).toBe(50);
    });
    it('builds a skater view with percentiles among his position', () => {
        const columns = ['id', 'pos', 'toi', 'toi_cur', 'toi_pp', 'toi_pk', 'ev_off', 'ev_def', 'pp_off', 'pk_def', 'ev_off_sh', 'ev_def_sh', 'g_ev_off', 'g_ev_def', 'g_pp', 'g_pk', 'g_fin', 'g_draw', 'g_take', 'g_total', 'fin_x', 'drawn60', 'taken60', 'ixg60', 'm_ev_off', 'm_ev_def', 'm_pp', 'm_pk'];
        const row = (id: number, pos: string, toi: number, total: number) => [id, pos, toi, 10, 50, 0, 0.2, -0.1, 0, 0, 1, -1, 3, 1, 0, 0, 0.5, 0.1, -0.1, total, 1 + total / 100, 1, total / 10, 0.5 + total / 100, 'AAF/', 'AAF/', '', ''];
        const doc = {
            version: 1, season: '20262027', window: ['20242025', '20252026', '20262027'], asof: '2026-10-06', half_life_days: 365,
            grid: { x0: 20, cell: 5, nx: 16, ny: 17, y0: -42.5, sigma: 10 }, std: { ev: 1000, pp: 125, pk: 125 },
            league: { ev_xg: 2.4, ev_sh: 41, pp_xg: 6.8, pp_sh: 75, minor_value: 0.13 }, scale: { ev_off: 0.0004, ev_def: 0.0003, pp: 0.0006, pk: 0.0006 },
            levels: { ev_off: [10, 20], ev_def: [8, 16], pp: [9, 18], pk: [9, 18] },
            columns, rows: [row(1, 'F', 900, 10), row(2, 'F', 900, 5), row(3, 'D', 900, 20), row(4, 'F', 100, 30)],
        } as IsolateDoc;
        const v = isolateFor(doc, 1)!;
        expect(v.player.pos).toBe('F');
        expect(v.player.goals.total).toBe(10);
        expect(v.player.maps.evOff).toEqual([0, 1, 127]);
        expect(v.player.maps.pp).toBeNull();
        expect(v.peers).toBe(2); // forwards with >= 500 minutes
        expect(v.pct.total).toBe(75);
        expect(isolateFor(doc, 4)!.pct.total).toBeNull(); // thin sample: no rank
        // distributions over his position's qualified peers; taken reads "good up" (fewer is better)
        expect(v.dists.shoot.value).toBeCloseTo(0.6);
        expect(v.dists.shoot.pct).toBe(75);
        expect(v.dists.take.pct).toBe(25); // takes more than the other forward
        expect(v.dists.fin.lo).toBeLessThan(1.05);
        expect(v.dists.fin.dens).toHaveLength(48);
        expect(isolateFor(doc, 4)!.dists.fin.pct).toBeNull();
        expect(isolateFor(doc, 99)).toBeNull();
    });
});
