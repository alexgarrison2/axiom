import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goalieShiftRows, parseToiReport, playCoverage, reportCode, reportShiftRows, shiftCoverage } from '../toi-report';

// BOS home report from PHI @ BOS (2026020070), captured live with 4:30 left in the 1st.
const html = readFileSync(resolve(__dirname, 'fixtures/TH020070.HTM'), 'utf8');

describe('NHL time-on-ice report', () => {
    it('reads every player and their completed shifts', () => {
        const players = parseToiReport(html);
        expect(players.length).toBeGreaterThanOrEqual(18);
        const lohrei = players.find(p => p.num === 6)!;
        expect(lohrei.name).toBe('LOHREI, MASON');
        expect(lohrei.shifts.slice(0, 2)).toEqual([
            { period: 1, start: '1:03', end: '1:54' },
            { period: 1, start: '3:35', end: '4:26' },
        ]);
    });

    it('becomes shift-chart rows by sweater number', () => {
        const rows = reportShiftRows(html, new Map([[6, 8482511]]));
        expect(rows.length).toBe(6);
        expect(rows[0]).toEqual({ typeCode: 517, playerId: 8482511, period: 1, startTime: '1:03', endTime: '1:54' });
        expect(reportCode(2026020070)).toBe('020070');
    });

    it('measures how far shift rows and the play-by-play reach, to pick the fuller source', () => {
        const rows = [
            { typeCode: 517, period: 1, endTime: '9:57' },
            { typeCode: 505, period: 2, endTime: '5:00' },
            { typeCode: 517, period: 1, endTime: '3:10' },
        ];
        expect(shiftCoverage(rows, 300)).toBe(597);
        expect(playCoverage([{ periodDescriptor: { number: 2 }, timeInPeriod: '4:30' }, { periodDescriptor: { number: 1 }, timeInPeriod: '19:00' }], 300)).toBe(1470);
        expect(shiftCoverage([{ typeCode: 517, period: 4, endTime: '1:00' }], 300)).toBe(3660);
    });

    it('skips a shootout but keeps playoff overtimes past the second', () => {
        const so = { periodDescriptor: { number: 5, periodType: 'SO' }, timeInPeriod: '0:00' };
        expect(playCoverage([{ periodDescriptor: { number: 4, periodType: 'OT' }, timeInPeriod: '5:00' }, so], 300)).toBe(3900);
        expect(playCoverage([{ periodDescriptor: { number: 6, periodType: 'OT' }, timeInPeriod: '2:00' }], 1200)).toBe(3600 + 2 * 1200 + 120);
        const shot = (number: number, periodType: string, t: string) => ({ periodDescriptor: { number, periodType }, timeInPeriod: t, situationCode: '1551', details: { goalieInNetId: 9, eventOwnerTeamId: 1 } });
        const rows = goalieShiftRows([shot(1, 'REG', '1:00'), shot(6, 'OT', '3:00')], { away: 1, home: 2 }, { otLength: 1200, final: true });
        expect(rows.filter(r => r.period === 6)).toEqual([{ typeCode: 517, playerId: 9, period: 6, startTime: '0:00', endTime: '20:00' }]);
        const reg = goalieShiftRows([shot(4, 'OT', '1:00'), { ...shot(5, 'SO', '0:00'), situationCode: '1010' }], { away: 1, home: 2 }, { otLength: 300, final: true });
        expect(reg.some(r => r.period === 5)).toBe(false);
    });
});
