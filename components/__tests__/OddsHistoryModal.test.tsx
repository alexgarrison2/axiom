// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OddsHistoryModal, { totalSummary } from '../OddsHistoryModal';
import type { OddsEntry } from '../../app/api/odds-history/route';
import type { TeamRef } from '../../types/prediction';

afterEach(cleanup);

const away = { triCode: 'NYI' } as TeamRef;
const home = { triCode: 'TOR' } as TeamRef;

const base = (over: Partial<OddsEntry>): OddsEntry => ({
    timestamp: '2026-09-30T12:42:49Z',
    awayOdds: '+110',
    homeOdds: '-130',
    awayDir: null,
    homeDir: null,
    isOpen: false,
    isLatest: false,
    total: null,
    totalDir: null,
    ...over,
});

function open(entries: OddsEntry[]) {
    render(<OddsHistoryModal entries={entries} away={away} home={home} />);
    fireEvent.click(screen.getByRole('button', { name: /line move/i }));
    return screen.getByRole('dialog');
}

describe('OddsHistoryModal totals (fix3-G5)', () => {
    it('shows the TOTAL tile and column when any snapshot has a total', () => {
        const d = open([
            base({ isOpen: true }),
            base({ timestamp: '2026-09-30T14:39:17Z', awayOdds: '+112', homeOdds: '-133', awayDir: 'up', homeDir: 'down' }),
            base({ timestamp: '2026-09-30T20:00:00Z', awayOdds: '+112', homeOdds: '-133', total: { line: '6.0', over: '-110', under: '-110' } }),
            base({ timestamp: '2026-09-30T21:00:00Z', awayOdds: '+115', homeOdds: '-136', isLatest: true, total: { line: '5.5', over: '-135', under: '+115' }, totalDir: 'down' }),
        ]);
        expect(within(d).getByRole('columnheader', { name: 'Total' })).toBeTruthy();
        expect(d.textContent).toContain('6.0 → 5.5');
        const rows = within(d).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(4);
        expect(rows[0].textContent).toContain('—'); // pre-upgrade point: no total, never invented
        expect(rows[3].textContent).toMatch(/5\.5/);
        expect(within(d).getByText('First').getAttribute('title')).toBeTruthy();
    });

    it('hides the TOTAL tile and column for a moneyline-only history', () => {
        const d = open([
            base({ isOpen: true }),
            base({ timestamp: '2026-09-30T14:39:17Z', awayOdds: '+112', homeOdds: '-133', isLatest: true }),
        ]);
        expect(within(d).queryByRole('columnheader', { name: 'Total' })).toBeNull();
        expect(within(d).getAllByRole('columnheader')).toHaveLength(3);
        expect(d.textContent).not.toMatch(/total/i);
    });

    it('summarises an unchanged total as the line alone', () => {
        expect(totalSummary({ line: '6.0', over: '-110', under: '-110' }, { line: '6.0', over: '-115', under: '-105' })).toBe('6.0');
        expect(totalSummary(null, { line: '6.0', over: '-110', under: '-110' })).toBe('6.0');
        expect(totalSummary(null, null)).toBeNull();
    });
});
