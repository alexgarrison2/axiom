// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OddsPanel } from '../../../components/matchup/OddsPanel';
import { MarketsTable } from '../../../components/matchup/MarketsTable';
import { compactForClient, parseMarkets, parseRow, type RawRow } from '../parse';
import { fmtEv, fmtSpread, hasInfoOnlyEv, marketRows, type MiddleRow, type SidesRow } from '../markets';
import { byTeams, fixture, fixtureRows, withOverrides } from './fixtures';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/client-data', () => ({ loadJson: () => Promise.resolve({ entries: [] }) }));

afterEach(cleanup);

/** Every simulator column of contract v2.2. */
const SIM_COLUMNS = [
    'sim_status', 'sim_version', 'sim_variant', 'sim_n', 'sim_home_win_pct', 'sim_expected_total',
    'home_reg_pct', 'reg_tie_pct', 'away_reg_pct', 'home_reg_fair', 'reg_tie_fair', 'away_reg_fair', 'home_reg_ev', 'reg_tie_ev', 'away_reg_ev',
    'sim_pl_spread', 'home_pl_pct', 'away_pl_pct', 'home_pl_fair', 'away_pl_fair', 'home_pl_ev', 'away_pl_ev',
    'sim_total_line', 'over_pct', 'total_push_pct', 'under_pct', 'over_fair', 'under_fair', 'over_ev', 'under_ev',
    'home_1p_pct', 'p1_tie_pct', 'away_1p_pct', 'home_1p_fair', 'p1_tie_fair', 'away_1p_fair', 'home_1p3_ev', 'p1_tie_ev', 'away_1p3_ev',
    'home_1p_2w_pct', 'away_1p_2w_pct', 'home_1p_2w_fair', 'away_1p_2w_fair', 'home_1p_ev', 'away_1p_ev',
    'home_1p_three_way', 'away_1p_three_way', 'p1_three_way_tie', 'sim_ev_gated', 'sim_gate_reason', 'sim_detail',
];

function row(away: string, home: string): RawRow {
    const r = fixtureRows('week3').find(x => x.away_abbrev === away && x.home_abbrev === home);
    if (!r) throw new Error('no row');
    return { ...r };
}

/** A fully priced, simulated row (the live file's shape on 2026-10-02). */
function priced(): RawRow {
    return {
        ...row('EDM', 'VAN'),
        sim_status: 'sim',
        home_puckline: '200', away_puckline: '-240', home_puckline_spread: '-1.5', away_puckline_spread: '+1.5',
        home_three_way: '122', away_three_way: '166', three_way_tie: '305',
        home_1p_ml: '-130', away_1p_ml: '100',
        home_1p_three_way: '168', away_1p_three_way: '190', p1_three_way_tie: '173',
        home_reg_ev: '-0.0099', reg_tie_ev: '-0.1212', away_reg_ev: '-0.1036',
        home_pl_ev: '0.0237', away_pl_ev: '-0.0667',
        home_1p3_ev: '-0.024', p1_tie_ev: '-0.0875', away_1p3_ev: '-0.1254',
        home_1p_ev: '-0.0214', away_1p_ev: '-0.0626',
    };
}

describe('parseMarkets (contract v2.2)', () => {
    it('reads every simulator market with numbers, fair strings and posted 1P 3-way prices', () => {
        const m = parseMarkets(priced())!;
        expect(m.status).toBe('sim');
        expect(m.evGated).toBe(false);
        expect(m.gateReason).toMatch(/^INFO ONLY/);
        expect(m.reg).toEqual({
            away: { pct: 50.5, fair: '-102', ev: -0.1036 },
            home: { pct: 33.7, fair: '+197', ev: -0.0099 },
            tie: { pct: 15.8, fair: '+533', ev: -0.1212 },
        });
        expect(m.pl).toEqual({ spread: '-1.5', away: { pct: 79.5, fair: '-389', ev: -0.0667 }, home: { pct: 20.5, fair: '+389', ev: 0.0237 } });
        expect(m.total).toEqual({ line: '6.0', pushPct: 11, over: { pct: 50.8, fair: '-133', ev: 0.0802 }, under: { pct: 38.2, fair: '+133', ev: -0.1611 } });
        expect(m.p1?.home).toEqual({ price: 168, pct: 30.6, fair: '+227', ev: -0.024 });
        expect(m.p1?.tie?.price).toBe(173);
        expect(m.p1TwoWay?.away).toEqual({ pct: 56.6, fair: '-130', ev: -0.0626 });
    });

    it('is undefined when the columns are absent (older SiteHistory rows)', () => {
        const r = priced();
        for (const c of SIM_COLUMNS) delete r[c];
        expect(parseMarkets(r)).toBeUndefined();
        expect(parseRow(r)?.markets).toBeUndefined();
    });

    it('turns empty, nan and junk cells into undefined fields, never NaN', () => {
        const r = { ...priced(), over_ev: '', under_pct: 'nan', away_pl_pct: 'NaN', home_reg_fair: '', total_push_pct: 'x', sim_status: 'bogus' };
        const m = parseMarkets(r)!;
        expect(m.status).toBeUndefined();
        expect(m.total?.over).toEqual({ pct: 50.8, fair: '-133' });
        expect(m.total?.under).toEqual({ fair: '+133', ev: -0.1611 });
        expect(m.total?.pushPct).toBeUndefined();
        expect(m.pl?.away).toEqual({ fair: '-389', ev: -0.0667 });
        expect(JSON.stringify(m)).not.toMatch(/NaN|null/);
    });

    it('survives the client payload: compactForClient keeps the markets', () => {
        const p = parseRow(priced())!;
        expect(compactForClient(p).markets?.total?.over?.ev).toBe(0.0802);
    });

    it('parses every fixture row without NaN', () => {
        for (const name of ['opening_night', 'week3', 'playoffs'] as const) {
            for (const p of fixture(name)) {
                const s = JSON.stringify(p.markets ?? {});
                expect(s).not.toMatch(/NaN/);
                if (p.status === 'no_pregame_prediction') expect(p.markets).toBeUndefined();
            }
        }
    });
});

describe('marketRows', () => {
    it('lists ML, PL, O/U + push, REG 3-WAY + tie, 1P 3-WAY + tie, 1P 2-WAY in order', () => {
        const rows = marketRows(parseRow(priced())!);
        expect(rows.map(r => r.key)).toEqual(['ml', 'pl', 'total', 'total-push', 'reg', 'reg-tie', 'p1', 'p1-tie', 'p1-2w']);
        const pl = rows.find(r => r.key === 'pl') as SidesRow;
        expect(pl.tags).toEqual(['+1.5', '−1.5']);
        expect(pl.away).toMatchObject({ price: -240, pct: 79.5 });
        expect(pl.gated).toBe(true);
        const total = rows.find(r => r.key === 'total') as SidesRow;
        expect(total.label).toBe('O/U 6');
        expect(total.away).toMatchObject({ price: -110, pct: 50.8, ev: 0.0802 });
        expect((rows.find(r => r.key === 'reg-tie') as MiddleRow).outcome).toMatchObject({ price: 305, pct: 15.8 });
        expect((rows.find(r => r.key === 'ml') as SidesRow).gated).toBe(false);
        expect(hasInfoOnlyEv(rows)).toBe(true);
    });

    it('shows model % and fair price without a posted price, and omits rows with nothing', () => {
        const p = parseRow(row('EDM', 'VAN'))!;
        const rows = marketRows(p);
        const reg = rows.find(r => r.key === 'reg') as SidesRow;
        expect(reg.home).toEqual({ pct: 33.7, fair: '+197' });
        expect(reg.home?.price).toBeUndefined();
        // No 1P 3-way price and no 1P EV: the row still shows the model.
        expect(rows.map(r => r.key)).toContain('p1');
        const bare = withOverrides(p, { markets: undefined, totalLine: null, totalOver: null, totalUnder: null });
        expect(marketRows(bare).map(r => r.key)).toEqual(['ml']);
    });

    it('drops the push row on half-goal lines', () => {
        const rows = marketRows(parseRow({ ...priced(), sim_total_line: '6.5', total_line: '6.5', total_push_pct: '0.0' })!);
        expect(rows.map(r => r.key)).not.toContain('total-push');
        expect(rows.find(r => r.key === 'total')?.label).toBe('O/U 6.5');
    });

    it('formats spreads and EV', () => {
        expect(fmtSpread('-1.5')).toBe('−1.5');
        expect(fmtSpread('-1.5', true)).toBe('+1.5');
        expect(fmtEv(0.0802)).toBe('+8.0%');
        expect(fmtEv(-0.0004)).toBe('0.0%');
        expect(fmtEv(-0.1611)).toBe('−16.1%');
        expect(fmtEv(undefined)).toBeNull();
    });
});

describe('Odds tab markets', () => {
    it('shows gated derivative EV as info only: no units, no +EV chip, sign-toned', () => {
        // ML EV below the betting floor, so the bet chip stays off and every edge on show is a derivative one.
        const p = withOverrides(parseRow(priced())!, {}, { home: { ev: -0.0333 }, away: { ev: -0.0435 } });
        const { container } = render(<OddsPanel p={p} phase="pre" />);
        const text = container.textContent ?? '';
        expect(text).not.toMatch(/\+EV/);
        // Units only ever ride on the ML bet chip ("No bet" explains its 0.5u floor in sr-only text).
        expect(container.querySelector('table[data-markets]')?.textContent).not.toMatch(/\b\d+(\.\d)?u\b/);
        expect(text).not.toMatch(/NaN/);
        const over = container.querySelector('tr[data-market="total"] [data-ev="info-only"]');
        expect(over?.textContent).toBe('+8.0%');
        expect(over?.className).toContain('text-pos');
        expect(container.querySelector('tr[data-market="total"]')?.getAttribute('data-gated')).toBe('true');
        const info = [...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('Info only'));
        expect(info?.getAttribute('href')).toBe('/methodology#term-sim-edge');
        expect(info?.getAttribute('data-gloss')).toBe('sim-edge');
        for (const label of ['REG 3-WAY', '1P 3-WAY', '1P 2-WAY', 'PUSH']) expect(text.toUpperCase()).toContain(label);
        expect([...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('Reg 3-way'))?.getAttribute('href')).toBe('/methodology#term-reg-3way');
        expect([...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('1P 3-way'))?.getAttribute('href')).toBe('/methodology#term-reg-3way');
    });

    it('drops the info-only note once the simulator gate opens', () => {
        const p = parseRow({ ...priced(), sim_ev_gated: 'True' })!;
        const { container } = render(<OddsPanel p={p} phase="pre" />);
        expect([...container.querySelectorAll('a')].some(a => a.textContent?.startsWith('Info only'))).toBe(false);
        expect(container.querySelector('[data-ev="info-only"]')).toBeNull();
    });

    it('tags a goal-model fallback EST, linked to the simulator entry', () => {
        const p = byTeams(fixture('week3'), 'EDM', 'VAN');
        expect(p.markets?.status).toBe('poisson_fallback');
        const { container } = render(<MarketsTable p={p} />);
        const est = [...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('Est'));
        expect(est?.getAttribute('href')).toBe('/methodology#term-simulator');
        // Unpriced markets: model % and fair price, price and edge as dashes.
        const reg = container.querySelector('tr[data-market="reg"]')!;
        expect(reg.textContent).toContain('33.7');
        expect(reg.textContent).toContain('+197');
        expect(reg.textContent).toContain('—');
        expect(container.textContent).not.toMatch(/NaN|undefined|null/);
    });

    it('renders nothing for a game without any market', () => {
        const p = byTeams(fixture('opening_night'), 'MTL', 'TOR');
        const { container } = render(<MarketsTable p={p} />);
        expect(container.querySelector('table')).toBeNull();
    });
});
