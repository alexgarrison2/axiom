import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactSkaters, DEFAULT_FILTER, filterSkaters, FIRST_DIR, headlineKey, ratingTone, sortSkaters, valueOf, type StatLine } from '../model';
import { asOfLabel, nameIndex, parseRatings, signed } from '@/lib/players/ratings';

/* ---------- v2: EV per 60 only ---------- */
const cols = ['id', 'name', 'team', 'pos', 'roster', 'rated', 'off', 'def', 'net', 'toi', 'gp', 'toi_cur', 'gp_cur'];
const doc = {
    version: 2,
    season: '20262027',
    season_label: '2026-27',
    as_of: '2026-09-30',
    columns: cols,
    rows: [
        [8478402, 'Connor McDavid', 'EDM', 'C', true, true, 0.763, -0.057, 0.706, 4842, 276, 17, 1],
        [8475913, 'Mark Stone', 'VGK', 'R', true, true, 0.35, 0.334, 0.684, 3016, 214, 13, 1],
        [8470638, 'Patrice Bergeron', 'BOS', 'C', false, true, 0.414, 0.539, 0.953, 0, 0, 0, 0],
        [8481606, 'Jordan Spence', 'OTT', 'D', true, true, 0.326, 0.184, 0.51, 3467, 234, 0, 0],
        [8490000, 'New Kid', 'NYI', 'L', true, false, -0.005, -0.001, -0.006, 0, 0, 0, 0],
    ],
};

/* ---------- v4 (real rows from the ratings-v4 export, 2026-10-02) ---------- */
const V3_COLS = ['id', 'name', 'team', 'pos', 'roster', 'rated', 'impact', 'off_impact', 'def_impact', 'sd', 'ev_off', 'ev_def', 'pp_off', 'pk_def', 'fin', 'toi_ev_gp', 'toi_pp_gp', 'toi_pk_gp', 'off', 'def', 'net', 'off_total', 'toi', 'gp', 'toi_cur', 'gp_cur'];
const V4_COLS = [...V3_COLS, 'pen_impact', 'pd60', 'pt60', 'spm_off', 'spm_def', 'spm_pp', 'spm_pk'];
const V4_ROWS = [
    [8480800, 'Quinn Hughes', 'MIN', 'D', true, true, 19.24, 15.26, 3.98, 3.92, 0.33, 0.095, -0.734, -0.91, -0.003, 22.97, 3.78, 0.31, 0.33, 0.095, 0.425, 0.327, 5183, 245, 20, 1, 3.15, 0.806, 0.473, 0.289, -0.024, -0.836, -0.963],
    [8478402, 'Connor McDavid', 'EDM', 'C', true, true, 17.89, 18.42, -0.52, 3.2, 0.594, -0.064, 1.256, 1.295, -0.044, 16.66, 3.42, 0.96, 0.594, -0.064, 0.53, 0.55, 4856, 277, 31, 2, 2.76, 1.332, 0.606, 0.549, -0.075, 1.055, 1.198],
    [8475913, 'Mark Stone', 'VGK', 'R', true, true, 10.18, 4.72, 5.46, 2.75, 0.164, 0.213, 0.662, 1.249, 0.054, 13.83, 3.31, 0.92, 0.164, 0.213, 0.377, 0.218, 3016, 214, 13, 1, 0.66, 0.675, 0.401, 0.184, 0.029, 0.553, 1.144],
    [8480801, 'Brady Tkachuk', 'FLA', 'L', true, true, 9.52, 10.62, -1.1, 2.64, 0.523, 0.036, 0.66, 1.271, -0.083, 12.92, 3.41, 0.17, 0.523, 0.036, 0.559, 0.44, 3177, 225, 23, 2, -0.15, 1.315, 1.261, 0.425, -0.027, 0.678, 1.265],
    [8476923, 'Damon Severson', 'CBJ', 'D', false, true, 7.59, 4.23, 3.36, 3.39, 0.105, 0.16, -0.964, -0.937, 0.014, 19.32, 0.99, 1.01, 0.105, 0.16, 0.265, 0.119, 3752, 208, 0, 0, -1.33, 0.328, 0.852, 0.025, -0.01, -0.981, -0.979],
    [8484790, 'Adam Jiricek', 'STL', 'D', true, false, -0.63, 1.4, -2.03, 3.9, 0.005, -0.088, -1.054, -1.041, 0.0, 16.54, 0.86, 1.57, 0.005, -0.088, -0.083, 0.005, 0, 0, 0, 0, 0.0, 0.434, 0.659, 0.005, -0.088, -1.054, -1.041],
];
const MEANS = {
    F: { ev_off: 0.0383, ev_def: -0.0107, fin: 0.0023, pp_off: 0.2424, pk_def: 1.0748, pd60: 0.7903, pt60: 0.6919 },
    D: { ev_off: -0.065, ev_def: 0.002, fin: 0.0028, pp_off: -0.9635, pk_def: -1.0314, pd60: 0.4342, pt60: 0.6594 },
};
const v4 = { version: 4, season: '20262027', season_label: '2026-27', as_of: '2026-10-02', impact: { games: 82, position_means: MEANS }, columns: V4_COLS, rows: V4_ROWS };
/** The v3 shape: the same file without the seven v4 columns. */
const v3 = { ...v4, version: 3, columns: V3_COLS, rows: V4_ROWS.map(r => r.slice(0, V3_COLS.length)) };

const line = (gp: number, g: number, a: number): StatLine => ({ gp, g, a, pts: g + a, sog: 3 * gp, toi: 1200 });
const lines = { cur: new Map([['8478402', line(1, 2, 1)]]), prev: new Map([['8478402', line(82, 48, 90)], ['8475913', line(60, 28, 45)]]) };
const noLines = { cur: new Map<string, StatLine>(), prev: new Map<string, StatLine>() };

describe('ratings parser (by column name)', () => {
    it('v2: EV per 60 only, every v3 / v4 column undefined', () => {
        const r = parseRatings(doc);
        expect(r.version).toBe(2);
        expect(r.positionMeans).toBeNull();
        const mc = r.byId.get(8478402)!;
        expect(mc).toMatchObject({ off: 0.763, def: -0.057, net: 0.706, toi: 4842 });
        for (const k of ['impact', 'offImpact', 'defImpact', 'sd', 'ppOff', 'pkDef', 'penImpact', 'toiPpGp', 'fin', 'offTotal'] as const) expect(mc[k], k).toBeUndefined();
    });

    it('v3: impact, OFF / DEF in goals per 82, PP / PK and the position means; no penalty columns', () => {
        const r = parseRatings(v3);
        expect(r.version).toBe(3);
        expect(r.positionMeans?.D.pp_off).toBe(-0.9635);
        const qh = r.byId.get(8480800)!;
        expect(qh).toMatchObject({ impact: 19.24, offImpact: 15.26, defImpact: 3.98, sd: 3.92, off: 0.33, def: 0.095, ppOff: -0.734, pkDef: -0.91, toiPpGp: 3.78 });
        expect(qh.penImpact).toBeUndefined();
        expect(qh.pd60).toBeUndefined();
    });

    it('v4: every column, read by name whatever the order', () => {
        const r = parseRatings(v4);
        expect(r.version).toBe(4);
        expect(r.byId.get(8478402)).toMatchObject({ impact: 17.89, offImpact: 18.42, defImpact: -0.52, penImpact: 2.76, pd60: 1.332, pt60: 0.606, fin: -0.044, offTotal: 0.55 });
        // Reverse the column order: the same values come out.
        const rev = { ...v4, columns: [...V4_COLS].reverse(), rows: V4_ROWS.map(row => [...row].reverse()) };
        expect(parseRatings(rev).byId.get(8478402)).toEqual(r.byId.get(8478402));
        // ev_off / ev_def win over the v2 names, and impact falls back to OFF + DEF when the column is missing.
        const noImpact = { ...v4, columns: V4_COLS.filter(c => c !== 'impact' && c !== 'off' && c !== 'def'), rows: V4_ROWS.map(row => row.filter((_, i) => !['impact', 'off', 'def'].includes(V4_COLS[i]))) };
        const qh = parseRatings(noImpact).byId.get(8480800)!;
        expect(qh.impact).toBeCloseTo(19.24, 2);
        expect(qh.off).toBe(0.33);
        for (const p of r.byId.values()) expect(Math.abs(p.offImpact! + p.defImpact! - p.impact!)).toBeLessThan(0.016);
    });

    it('rejects files without ids or EV ratings', () => {
        expect(parseRatings(null).byId.size).toBe(0);
        expect(parseRatings({ columns: ['id', 'name'], rows: [[1, 'X']] }).byId.size).toBe(0);
    });
});

describe('players model', () => {
    const rows = compactSkaters(doc, lines, { '8490000': { isRookie: true } });

    it('v2: keeps current-roster skaters, joins counting lines and opens on NET', () => {
        expect(rows.map(r => r.name)).not.toContain('Patrice Bergeron');
        expect(rows).toHaveLength(4);
        const mc = rows.find(r => r.id === '8478402')!;
        expect(mc).toMatchObject({ net: 0.706, evOff: 0.763, evDef: -0.057, impact: null, offImp: null, pen: null, pp: null, pk: null, fin: null, evMin: 4842, fwd: true, rated: true });
        expect(valueOf(mc, 'pts', 'cur')).toBe(3);
        expect(valueOf(mc, 'pts', 'prev')).toBe(138);
        expect(valueOf(rows.find(r => r.id === '8481606')!, 'gp', 'cur')).toBe(0);
        expect(valueOf(rows.find(r => r.id === '8481606')!, 'pts', 'cur')).toBeNull();
        expect(rows.find(r => r.id === '8490000')).toMatchObject({ rookie: true, rated: false });
        expect(headlineKey(rows)).toBe('net');
        expect(sortSkaters(rows, 'net', 'desc')[0].name).toBe('Connor McDavid');
        // Every impact value is missing: sorting by it falls to name order, never a crash.
        expect(sortSkaters(rows, 'impact', 'desc').map(r => r.name)).toEqual(['Connor McDavid', 'Jordan Spence', 'Mark Stone', 'New Kid']);
    });

    it('v4: IMPACT headline, OFF / DEF / PEN in goals per 82, rates centred on the position average', () => {
        const sk = compactSkaters(v4, noLines, {});
        expect(sk.map(p => p.name)).not.toContain('Damon Severson'); // not on a roster
        expect(headlineKey(sk)).toBe('impact');
        const qh = sk.find(p => p.name === 'Quinn Hughes')!;
        expect(qh).toMatchObject({ impact: 19.24, offImp: 15.26, defImp: 3.98, sd: 3.92, pen: 3.15, ppGp: 3.78, pkGp: 0.31, net: 0.425 });
        // D means: ev_off −0.065, pp_off −0.9635 → Hughes' PP rate is above the D average.
        expect(qh.evOff).toBeCloseTo(0.395, 3);
        expect(qh.pp).toBeCloseTo(0.23, 2);
        expect(qh.pk).toBeCloseTo(0.121, 3);
        const mc = sk.find(p => p.name === 'Connor McDavid')!;
        expect(mc.pp).toBeCloseTo(1.256 - 0.2424, 3);
        expect(mc.fin).toBeCloseTo(-0.0463, 3);
        // v3 has everything but PEN.
        const s3 = compactSkaters(v3, noLines, {});
        expect(s3.find(p => p.name === 'Quinn Hughes')).toMatchObject({ impact: 19.24, pen: null });
        expect(headlineKey(s3)).toBe('impact');
    });

    it('v4 sorting: IMPACT by default, each column best first, missing values last', () => {
        const sk = compactSkaters(v4, noLines, {});
        expect(sortSkaters(sk, 'impact', 'desc').map(p => p.name)).toEqual(['Quinn Hughes', 'Connor McDavid', 'Mark Stone', 'Brady Tkachuk', 'Adam Jiricek']);
        expect(sortSkaters(sk, 'impact', 'asc')[0].name).toBe('Adam Jiricek');
        expect(sortSkaters(sk, 'offImp', 'desc')[0].name).toBe('Connor McDavid');
        expect(sortSkaters(sk, 'defImp', 'desc')[0].name).toBe('Mark Stone');
        expect(sortSkaters(sk, 'pen', 'desc')[0].name).toBe('Quinn Hughes');
        expect(sortSkaters(sk, 'evDef', 'desc')[0].name).toBe('Mark Stone');
        expect(sortSkaters(sk, 'pp', 'desc')[0].name).toBe('Connor McDavid');
        for (const k of ['impact', 'offImp', 'defImp', 'pen', 'evOff', 'evDef', 'pp', 'pk', 'fin'] as const) expect(FIRST_DIR[k] ?? 'desc', k).toBe('desc');
        const withHole = sk.map(p => (p.name === 'Quinn Hughes' ? { ...p, pen: null } : p));
        expect(sortSkaters(withHole, 'pen', 'desc').at(-1)?.name).toBe('Quinn Hughes');
        expect(sortSkaters(withHole, 'pen', 'asc').at(-1)?.name).toBe('Quinn Hughes');
    });

    it('filters by position, team, rookies and EV sample', () => {
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, pos: 'D' }).map(r => r.name)).toEqual(['Jordan Spence']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, team: 'VGK' }).map(r => r.name)).toEqual(['Mark Stone']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, rookies: true }).map(r => r.name)).toEqual(['New Kid']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, minEv: 1000 })).toHaveLength(3);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, q: 'edm' }).map(r => r.name)).toEqual(['Connor McDavid']);
    });

    it('colours only clear signals with a real sample; positive DEF is good', () => {
        const p = { rated: true, evMin: 3000 };
        expect(ratingTone(0.7, p, 0.25)).toBe('pos');
        expect(ratingTone(-0.3, p, 0.25)).toBe('neg');
        expect(ratingTone(0.1, p, 0.25)).toBeNull();
        expect(ratingTone(5.5, p, 2.5)).toBe('pos');
        expect(ratingTone(0.7, { rated: false, evMin: 0 }, 0.25)).toBeNull();
        expect(ratingTone(19, { rated: true, evMin: 100 }, 5)).toBeNull();
    });

    it('labels the date and resolves names strictly', () => {
        const r = parseRatings(doc);
        expect(r.season).toBe('20262027');
        expect(asOfLabel(r.asOf)).toBe('SEP 30');
        expect(signed(-0.2)).toBe('−0.20');
        expect(signed(0.004)).toBe('0.00');
        expect(signed(19.24, 1)).toBe('+19.2');
        const find = nameIndex(r);
        expect(find('Connor McDavid', 'EDM')?.id).toBe(8478402);
        expect(find('C McDavid', 'EDM')?.id).toBe(8478402);
        expect(find('McDavid', 'EDM')).toBeNull();
        expect(find('Anyone', 'EDM', 8475913)?.name).toBe('Mark Stone');
    });

    it('the published file (v2 today, v4 once it lands) ranks the stars near the top', () => {
        const pub = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8'));
        const all = compactSkaters(pub, noLines, {});
        // 32 teams x 20+ rostered skaters (opening rosters land just under or over 700).
        expect(all.length).toBeGreaterThanOrEqual(640);
        const top = sortSkaters(all, headlineKey(all), 'desc').slice(0, 20).map(r => r.name);
        for (const n of ['Connor McDavid', 'Nathan MacKinnon']) expect(top).toContain(n);
        expect(all.map(r => r.name)).not.toContain('Patrice Bergeron');
    });
});
