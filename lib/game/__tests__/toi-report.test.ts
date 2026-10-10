import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseToiReport, reportCode, reportShiftRows } from '../toi-report';

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
});
