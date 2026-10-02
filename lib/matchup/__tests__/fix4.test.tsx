// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchupCard } from '../../../components/matchup/MatchupCard';
import { OddsPanel } from '../../../components/matchup/OddsPanel';
import { WhyThisPick } from '../../../components/matchup/WhyThisPick';
import OddsHistoryModal from '../../../components/OddsHistoryModal';
import type { OddsEntry } from '../../../app/api/odds-history/route';
import type { Prediction, TeamRef } from '../../../types/prediction';
import { sourceLabel, sourceTag } from '../format';
import { anyBookChange, bookChanged, bookSwitches } from '../line-move';
import { modelLean } from '../edge';
import { byTeams, fixture, withOverrides } from './fixtures';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/client-data', () => ({ loadJson: () => Promise.resolve({ entries: [] }) }));

afterEach(cleanup);

const opening = fixture('opening_night');

function card(p: Prediction) {
    return render(<MatchupCard p={p} live={null} implication={null} playoffOdds={{}} />).container;
}

describe('F4-4 odds source labels', () => {
    it('gives every source in public/data/odds.json a human book name', () => {
        const odds = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'odds.json'), 'utf8')) as Record<string, { source?: string }>;
        const sources = [...new Set(Object.values(odds).map(g => g?.source).filter((s): s is string => typeof s === 'string'))];
        expect(sources.length).toBeGreaterThan(0);
        for (const s of sources) {
            const label = sourceLabel(s);
            expect(label, s).toBeTruthy();
            expect(label!, s).not.toContain('_');
            expect(label!, s).not.toMatch(/^[A-Z_]{4,}$/);
        }
    });

    it('names the known feeds and cleans up unknown ids', () => {
        expect(sourceLabel('nhl_partner_draftkings')).toBe('DraftKings via NHL');
        expect(sourceLabel('espn_draftkings')).toBe('DraftKings via ESPN');
        expect(sourceLabel('NHL_PARTNER_DRAFTKINGS')).toBe('DraftKings via NHL');
        expect(sourceLabel('bovada')).toBe('Bovada');
        expect(sourceLabel('espn_fanduel')).toBe('FanDuel');
        expect(sourceLabel('nhl_partner_betmgm')).toBe('BetMGM');
        expect(sourceLabel('some_new_book')).toBe('Some New Book');
        expect(sourceLabel('feed_20260930_x')).toBeNull();
        expect(sourceLabel('')).toBeNull();
        expect(sourceLabel(null)).toBeNull();
    });

    it('tags books tersely and treats a feed as the same book', () => {
        expect(sourceTag('bovada')).toBe('BOV');
        expect(sourceTag('nhl_partner_draftkings')).toBe('DK');
        expect(sourceTag('espn_draftkings')).toBe('DK');
        expect(sourceTag(null)).toBeNull();
    });
});

describe('F4-8 line move across a book switch', () => {
    const away = { triCode: 'NYI' } as TeamRef;
    const home = { triCode: 'TOR' } as TeamRef;
    const e = (over: Partial<OddsEntry>): OddsEntry => ({
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
    // NYI@TOR 2026-09-30: two Bovada snapshots, then DraftKings via the NHL feed.
    const entries = [
        e({ isOpen: true, source: 'bovada' }),
        e({ timestamp: '2026-09-30T14:39:17Z', awayOdds: '+112', homeOdds: '-133', awayDir: 'up', homeDir: 'down', source: 'bovada' }),
        e({ timestamp: '2026-09-30T20:10:37Z', awayOdds: '+110', homeOdds: '-130', awayDir: 'down', homeDir: 'up', isLatest: true, source: 'nhl_partner_draftkings', total: { line: '5.5', over: '-135', under: '+114' } }),
    ];

    it('/api/odds-history passes each snapshot’s book through (NYI@TOR 2026-09-30)', async () => {
        const { NextRequest } = await import('next/server');
        const { GET } = await import('../../../app/api/odds-history/route');
        const q = new URLSearchParams({ gameId: '2026020008', date: '2026-09-30', legacyId: '2026-09-30-Islanders-Maple Leafs' });
        const res = await GET(new NextRequest(`http://localhost/api/odds-history?${q}`));
        const { entries } = (await res.json()) as { entries: OddsEntry[] };
        expect(entries.length).toBeGreaterThanOrEqual(3);
        for (const x of entries) expect(x.source, x.timestamp).toBeTruthy();
        expect(entries.slice(0, 3).map(x => sourceTag(x.source))).toEqual(['BOV', 'BOV', 'DK']);
    });

    it('detects a book change and ignores the feed a book came through', () => {
        expect(bookChanged(entries[0], entries[1])).toBe(false);
        expect(bookChanged(entries[1], entries[2])).toBe(true);
        expect(bookChanged({ source: 'nhl_partner_draftkings' }, { source: 'espn_draftkings' })).toBe(false);
        expect(bookChanged({ source: null }, { source: 'bovada' })).toBe(false);
        expect(bookChanged(null, entries[0])).toBe(false);
        expect(anyBookChange(entries)).toBe(true);
        expect(anyBookChange(entries.slice(0, 2))).toBe(false);
        // An unknown-source snapshot between two books does not hide the switch.
        expect(bookSwitches([{ source: 'bovada' }, { source: null }, { source: 'nhl_partner_draftkings' }])).toEqual([false, false, true]);
        expect(bookSwitches([{ source: null }, { source: 'bovada' }, { source: 'bovada' }])).toEqual([false, false, false]);
    });

    it('shows the book per row and no shortened/drifted arrow on the switch', () => {
        render(<OddsHistoryModal entries={entries} away={away} home={home} />);
        fireEvent.click(screen.getByRole('button', { name: /line move/i }));
        const d = screen.getByRole('dialog');
        const rows = within(d).getAllByRole('row').slice(1);
        expect(rows.map(r => r.getAttribute('data-book'))).toEqual(['BOV', 'BOV', 'DK']);
        // 7:42 → 9:39 is a real Bovada move.
        expect(rows[1].textContent).toMatch(/drifted|shortened/);
        // 9:39 → 3:10 is Bovada → DraftKings: marked, no arrows.
        expect(rows[2].getAttribute('data-book-change')).toBe('true');
        expect(rows[2].textContent).toContain('⇄');
        expect(rows[2].textContent).not.toMatch(/drifted|shortened|▲|▼/);
        expect(within(rows[2]).getByTitle('Book changed')).toBeTruthy();
        // The open → latest tiles are cross-book too: no arrow there either.
        const tiles = d.querySelectorAll('.tile');
        for (const t of tiles) expect(t.textContent).not.toMatch(/drifted|shortened/);
    });
});

describe('F4-3 card symbols open the glossary without toggling the card', () => {
    it('renders the lean flag as a /methodology#term-lean link outside the expand button', () => {
        const p = byTeams(opening, 'CHI', 'VGK');
        const lean = modelLean(p)!;
        expect(lean).not.toBeNull();
        const c = card(p);
        const a = c.querySelector<HTMLAnchorElement>('a[data-lean]')!;
        expect(a.getAttribute('href')).toBe('/methodology#term-lean');
        expect(a.closest('button')).toBeNull();
        expect(a.querySelector('[aria-hidden="true"]')?.textContent).toContain(`◆ ${lean.pct} VGK`);
        expect(a.textContent).toMatch(new RegExp(`Model lean: VGK ${lean.pct}%, [\\d.]+ points off the market`));
        expect(a.className).toMatch(/\bz-10\b/);
        expect(a.className).toMatch(/\bmin-h-6\b/);
        const toggle = c.querySelector('button[aria-expanded]')!;
        fireEvent.click(a);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('renders the B2B chip as a /methodology#term-b2b link', () => {
        const base = byTeams(opening, 'CHI', 'VGK');
        const p = withOverrides(base, {}, { home: { isB2b: true } });
        const c = card(p);
        const a = c.querySelector<HTMLAnchorElement>('a[data-chip]')!;
        expect(a.getAttribute('href')).toBe('/methodology#term-b2b');
        expect(a.textContent).toContain('B2B');
        expect(a.textContent).toContain('VGK played yesterday');
        expect(a.closest('button')).toBeNull();
        expect(a.getAttribute('aria-hidden')).toBeNull();
    });

    it('links FORECAST, xG and NO BET in the Odds tab', () => {
        const p = byTeams(opening, 'CHI', 'VGK');
        const { container } = render(<OddsPanel p={p} phase="pre" />);
        const forecast = [...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('Forecast'));
        expect(forecast?.getAttribute('href')).toBe('/methodology#term-model-pct');
        const xg = [...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('xG'));
        if (p.away.xg != null) expect(xg?.getAttribute('href')).toBe('/methodology#term-projected-goals');
        const noBet = [...container.querySelectorAll('a')].find(a => a.textContent?.startsWith('No bet'));
        if (noBet) expect(noBet.getAttribute('href')).toBe('/methodology#edge');
    });
});

describe('F4-7 Why tab NET rounds like the bar', () => {
    it('reads CBJ 51 for a 51.5 forecast, matching the bar', () => {
        const base = byTeams(opening, 'CHI', 'VGK');
        // The published file's breakdown sums to the forecast: 50 + 1.0 + 0.5 = 51.5 for the home side.
        const p = withOverrides(
            base,
            {
                breakdown: [
                    { factor: 'home_ice', label: 'Home ice', wp_delta_pts: 1.0 },
                    { factor: 'market', label: 'Market', wp_delta_pts: 0.5 },
                ],
            },
            { home: { winPct: 51.5 }, away: { winPct: 48.5 } },
        );
        const { container } = render(<WhyThisPick p={p} />);
        const tri = p.home.team.triCode;
        expect(container.querySelector('h3')?.textContent).toBe(`Why: ${tri} 51%`);
        expect(container.textContent).toContain(`${tri} 51`);
        expect(container.textContent).not.toContain(`${tri} 52`);
    });
});
