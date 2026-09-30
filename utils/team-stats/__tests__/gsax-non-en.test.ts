import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { gsaxOf, parseGameRow } from '../game-row';

/*
 * fix2-I3: team GSAx leaves out the opponent's empty-net chances.
 * Both server mirrors of this season's gamestats carry xga_non_en (synced
 * whole-file by refresh_pipeline.stage_sync_gamestats), and GSAx is
 * xga_non_en − (GA − empty-net GA).
 */
const MIRRORS = ['data/gamestats.csv', 'public/data/gamestats.csv'];
const TEAMS: Record<string, string> = { 'Maple Leafs': 'TOR', Canadiens: 'MTL' };

function rows(file: string) {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
}

describe('GSAx excludes empty-net xG', () => {
    for (const file of MIRRORS) {
        it(`${file} has the xga_non_en column, filled on every row`, () => {
            const { meta, data } = rows(file);
            expect(meta.fields).toContain('xga_non_en');
            for (const r of data) expect(Number.isFinite(Number(r.xga_non_en)), `${r.game_id} ${r.team}`).toBe(true);
        });
    }

    it('non-EN xG against never exceeds all-situations xG against', () => {
        for (const r of rows('public/data/gamestats.csv').data) {
            expect(Number(r.xga_non_en)).toBeLessThanOrEqual(Number(r.xG_against) + 1e-9);
        }
    });

    it('TOR on 2026-09-29 (MTL 3-2): GSAx comes from non-EN xGA, so it is negative', () => {
        const raw = rows('public/data/gamestats.csv').data.find(r => r.game_id === '2026020002' && r.team === 'Maple Leafs');
        if (!raw) return; // a later season's mirror no longer holds opening night
        const g = parseGameRow(raw, n => TEAMS[n])!;
        expect(g.xgane).toBeCloseTo(Number(raw.xga_non_en), 4);
        // MTL's late empty-net attempts are in xG_against but not in xga_non_en.
        expect(g.xga).toBeGreaterThan(g.xgane);
        expect(g.enga).toBe(0);
        const gsax = gsaxOf(g);
        expect(gsax).toBeCloseTo(g.xgane - g.ga, 6);
        expect(gsax).toBeLessThan(0);
        // With all-situations xG it would wrongly read as a positive night.
        expect(g.xga - g.ga).toBeGreaterThan(0);
    });
});
