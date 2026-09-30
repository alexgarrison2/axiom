import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { parseRow, type RawRow } from '../parse';
import type { Prediction } from '../../../types/prediction';

/** pipeline/fixtures/*.csv (contract v2), parsed exactly as the home page parses the live file. */
export function fixtureRows(name: 'opening_night' | 'week3' | 'playoffs'): RawRow[] {
    const csv = fs.readFileSync(path.join(process.cwd(), 'pipeline', 'fixtures', `predictions_${name}.csv`), 'utf8');
    return Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: true }).data;
}

export function fixture(name: 'opening_night' | 'week3' | 'playoffs'): Prediction[] {
    return fixtureRows(name)
        .map(r => parseRow(r))
        .filter((p): p is Prediction => p !== null);
}

export function byTeams(preds: Prediction[], away: string, home: string): Prediction {
    const p = preds.find(x => x.away.team.triCode === away && x.home.team.triCode === home);
    if (!p) throw new Error(`no ${away}@${home} in fixture`);
    return p;
}

/** A copy of a prediction with overrides applied. */
export function withOverrides(p: Prediction, o: Partial<Prediction>, side?: { home?: Partial<Prediction['home']>; away?: Partial<Prediction['away']> }): Prediction {
    return { ...p, ...o, home: { ...p.home, ...(side?.home ?? {}) }, away: { ...p.away, ...(side?.away ?? {}) } };
}
