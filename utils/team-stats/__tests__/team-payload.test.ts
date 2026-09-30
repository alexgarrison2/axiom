import { beforeAll, describe, expect, it } from 'vitest';
import { buildTeamPayload } from '../server-team';
import { PREVIOUS_SEASON_ID, CURRENT_SEASON_ID } from '../season';
import type { TeamPayload } from '../team-types';

let edm: TeamPayload;
let edmLast: TeamPayload;

beforeAll(async () => {
    edm = await buildTeamPayload('EDM', CURRENT_SEASON_ID);
    edmLast = await buildTeamPayload('EDM', PREVIOUS_SEASON_ID, { boxscores: true });
}, 30_000);

describe('team skater cards', () => {
    it('pts === g + a for every season line', () => {
        for (const p of [...edm.skaters, ...edmLast.skaters]) {
            for (const line of [p.current, p.last]) {
                if (line) expect(line.pts, p.name).toBe(line.g + line.a);
            }
        }
    });

    it('McDavid: last season 82 GP with 48-90-138; this season 0-1 GP', () => {
        const mcd = edm.skaters.find(s => s.id === '8478402')!;
        expect(mcd).toBeDefined();
        expect(mcd.last).toMatchObject({ gp: 82, g: 48, a: 90, pts: 138 });
        expect(mcd.current?.gp ?? 0).toBeLessThanOrEqual(1);
    });

    it('lists only the current roster (no Nurse, Henrique or Roslovic)', () => {
        const names = edm.skaters.map(s => s.name);
        for (const gone of ['Darnell Nurse', 'Adam Henrique', 'Jack Roslovic']) expect(names).not.toContain(gone);
        expect(edm.skaters.length).toBeGreaterThanOrEqual(18);
    });

    it('tags new arrivals', () => {
        const shea = edm.skaters.find(s => s.name === 'Ryan Shea');
        expect(shea?.isNew).toBe(true);
        expect(edm.skaters.find(s => s.name === 'Connor McDavid')?.isNew).toBe(false);
    });

    it('availability never marks a whole season as missed for a regular', () => {
        const mcd = edmLast.skaters.find(s => s.id === '8478402')!;
        expect(mcd.last!.avail.length).toBe(82);
        expect(mcd.last!.avail.split('').filter(c => c === '1').length).toBe(82);
    });
});

describe('team payload', () => {
    it('stays small (≤200KB with boxscores)', () => {
        expect(JSON.stringify(edmLast).length).toBeLessThan(200_000);
    });

    it('goalies come from the roster with season-labelled lines', () => {
        expect(edm.goalies.map(g => g.name).sort()).toEqual(expect.arrayContaining(['Tristan Jarry']));
        const jarry = edmLast.goalies.find(g => g.name === 'Tristan Jarry');
        expect(jarry?.last?.gp ?? 0).toBeGreaterThan(0);
    });

    it('2025-26 regular-season record is 41-30-11', () => {
        expect(edmLast.standing).toMatchObject({ gp: 82, wins: 41, losses: 30, otl: 11, points: 93 });
    });
});
