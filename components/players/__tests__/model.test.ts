import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactSkaters, DEFAULT_FILTER, filterSkaters, ratingTone, sortSkaters, valueOf, type StatLine } from '../model';
import { asOfLabel, nameIndex, parseRatings, signed } from '@/lib/players/ratings';

const cols = ['id', 'name', 'team', 'pos', 'roster', 'rated', 'off', 'def', 'net', 'toi', 'gp', 'toi_cur', 'gp_cur'];
const doc = {
    season: '20262027',
    season_label: '2026-27',
    as_of: '2026-09-30',
    columns: cols,
    rows: [
        [8478402, 'Connor McDavid', 'EDM', 'C', true, true, 0.763, 0.057, 0.706, 4842, 276, 17, 1],
        [8475913, 'Mark Stone', 'VGK', 'R', true, true, 0.35, -0.334, 0.684, 3016, 214, 13, 1],
        [8470638, 'Patrice Bergeron', 'BOS', 'C', false, true, 0.414, -0.539, 0.953, 0, 0, 0, 0],
        [8481606, 'Jordan Spence', 'OTT', 'D', true, true, 0.326, -0.184, 0.51, 3467, 234, 0, 0],
        [8490000, 'New Kid', 'NYI', 'L', true, false, -0.005, 0.001, -0.006, 0, 0, 0, 0],
    ],
};
const line = (gp: number, g: number, a: number): StatLine => ({ gp, g, a, pts: g + a, sog: 3 * gp, toi: 1200 });
const lines = { cur: new Map([['8478402', line(1, 2, 1)]]), prev: new Map([['8478402', line(82, 48, 90)], ['8475913', line(60, 28, 45)]]) };

describe('players model (RAPM v2 ratings)', () => {
    const rows = compactSkaters(doc, lines, { '8490000': { isRookie: true } });

    it('keeps current-roster skaters only and joins counting lines', () => {
        expect(rows.map(r => r.name)).not.toContain('Patrice Bergeron');
        expect(rows).toHaveLength(4);
        const mc = rows.find(r => r.id === '8478402')!;
        expect(mc).toMatchObject({ net: 0.71, off: 0.76, def: 0.06, evMin: 4842, fwd: true, rated: true });
        expect(valueOf(mc, 'pts', 'cur')).toBe(3);
        expect(valueOf(mc, 'pts', 'prev')).toBe(138);
        expect(valueOf(rows.find(r => r.id === '8481606')!, 'gp', 'cur')).toBe(0);
        expect(valueOf(rows.find(r => r.id === '8481606')!, 'pts', 'cur')).toBeNull();
        expect(rows.find(r => r.id === '8490000')).toMatchObject({ rookie: true, rated: false });
    });

    it('sorts by NET by default and DEF ascending puts the best defender first', () => {
        expect(sortSkaters(rows, 'net', 'desc').map(r => r.name)[0]).toBe('Connor McDavid');
        expect(sortSkaters(rows, 'def', 'asc').map(r => r.name)[0]).toBe('Mark Stone');
        // Missing counting values sort last either way.
        expect(sortSkaters(rows, 'pts', 'asc', 'prev').at(-1)?.name).not.toBe('Mark Stone');
    });

    it('filters by position, team, rookies and EV sample', () => {
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, pos: 'D' }).map(r => r.name)).toEqual(['Jordan Spence']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, team: 'VGK' }).map(r => r.name)).toEqual(['Mark Stone']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, rookies: true }).map(r => r.name)).toEqual(['New Kid']);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, minEv: 1000 })).toHaveLength(3);
        expect(filterSkaters(rows, { ...DEFAULT_FILTER, q: 'edm' }).map(r => r.name)).toEqual(['Connor McDavid']);
    });

    it('colours only clear signals with a real sample; lower DEF is good', () => {
        const p = { rated: true, evMin: 3000 };
        expect(ratingTone(0.7, p, 0.25)).toBe('pos');
        expect(ratingTone(-0.3, p, 0.25)).toBe('neg');
        expect(ratingTone(0.1, p, 0.25)).toBeNull();
        expect(ratingTone(-0.33, p, 0.16, true)).toBe('pos');
        expect(ratingTone(0.7, { rated: false, evMin: 0 }, 0.25)).toBeNull();
        expect(ratingTone(0.7, { rated: true, evMin: 100 }, 0.25)).toBeNull();
    });

    it('parses the file, labels the date and resolves names strictly', () => {
        const r = parseRatings(doc);
        expect(r.season).toBe('20262027');
        expect(asOfLabel(r.asOf)).toBe('SEP 30');
        expect(signed(-0.2)).toBe('−0.20');
        expect(signed(0.004)).toBe('0.00');
        const find = nameIndex(r);
        expect(find('Connor McDavid', 'EDM')?.id).toBe(8478402);
        expect(find('C McDavid', 'EDM')?.id).toBe(8478402);
        expect(find('McDavid', 'EDM')).toBeNull();
        expect(find('Anyone', 'EDM', 8475913)?.name).toBe('Mark Stone');
    });

    it('the published file ranks the stars near the top of rostered skaters', () => {
        const pub = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8'));
        const all = compactSkaters(pub, { cur: new Map(), prev: new Map() }, {});
        expect(all.length).toBeGreaterThanOrEqual(700);
        const top = sortSkaters(all, 'net', 'desc').slice(0, 15).map(r => r.name);
        for (const n of ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews']) expect(top).toContain(n);
        expect(all.map(r => r.name)).not.toContain('Patrice Bergeron');
    });
});
