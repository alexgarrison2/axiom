import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { fairLine, parseRow, type RawRow } from '../parse';
import { fixtureRows } from './fixtures';

/** American odds → implied probability (0-100). */
const pctOf = (o: string) => {
    const n = Number(o.replace('+', ''));
    return n < 0 ? (100 * -n) / (-n + 100) : (100 * 100) / (n + 100);
};

function liveRows(): RawRow[] {
    const csv = fs.readFileSync(path.join(process.cwd(), 'data', 'predictions_detailed.csv'), 'utf8');
    return Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: true }).data;
}

describe('Fair odds on the card are the fair line of the published % (fix2-I7)', () => {
    it('fairLine matches the pipeline prob_to_odds', () => {
        expect(fairLine(51.4)).toBe('-106');
        expect(fairLine(38.9)).toBe('+157');
        expect(fairLine(50)).toBe('+100');
        expect(fairLine(null)).toBeNull();
        expect(fairLine(0)).toBeNull();
    });

    for (const [name, rows] of [
        ['live data/predictions_detailed.csv', liveRows()],
        ['fixture opening_night', fixtureRows('opening_night')],
        ['fixture week3', fixtureRows('week3')],
    ] as const) {
        it(`every card in ${name}: Fair converts back to Our forecast %`, () => {
            let checked = 0;
            for (const r of rows) {
                const p = parseRow(r);
                if (!p) continue;
                for (const s of [p.home, p.away]) {
                    if (s.fairOdds == null || s.winPct == null) continue;
                    // within one cent of American odds == well within 0.3 pts of probability
                    expect(Math.abs(pctOf(s.fairOdds) - s.winPct), `${p.away.team.triCode}@${p.home.team.triCode} ${s.team.triCode}`).toBeLessThan(0.3);
                    checked++;
                }
            }
            expect(checked).toBeGreaterThan(0);
        });
    }

    it('falls back to the published % when a row has no blend_odds', () => {
        const [row] = fixtureRows('opening_night').filter(r => r.home_win_pct);
        const p = parseRow({ ...row, home_blend_odds: '', away_blend_odds: '' })!;
        expect(p.home.fairOdds).toBe(fairLine(p.home.winPct));
    });
});
