// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchupCard } from '../../../components/matchup/MatchupCard';
import { GoaliesPanel } from '../../../components/matchup/GoaliesPanel';
import { LineupsPanel } from '../../../components/matchup/LineupsPanel';
import { ArchiveCard } from '../../../components/matchup/ArchiveCard';
import { ContextChips } from '../../../components/matchup/ContextChips';
import { WhyPanel } from '../../../components/matchup/WhyPanel';
import { YourTeamStrip } from '../../../components/matchup/SlateStrips';
import { WinBarLegend } from '../../../components/ui/win-bar';
import type { LiveGame } from '../lifecycle';
import type { Prediction } from '../../../types/prediction';
import type { GameDetails } from '../../client-data';
import type { ArchiveGame } from '../archive';
import { byTeams, fixture, withOverrides } from './fixtures';
import { gsaxHeadline, isCoinFlip, shortAge, windowTag, SMALL_SAMPLE_GP } from '../format';
import { CARD_ANCHORS, PENDING_ANCHORS, READING_HREF, termHref } from '../glossary-links';
import { GLOSSARY_TERMS } from '../../glossary';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { slateTitle } from '../archive';
import { SEASON_ID } from '../../season';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

afterEach(cleanup);

const opening = fixture('opening_night');
const pitPhi = byTeams(opening, 'PIT', 'PHI');

function card(p: Prediction, live: LiveGame | null = null) {
    return render(<MatchupCard p={p} live={live} implication={null} playoffOdds={{}} favorites={[]} onFavorite={() => {}} />).container;
}

/** Visible text only (drops .sr-only and aria-hidden copies is NOT done: aria-hidden glyphs are visible). */
function visible(el: HTMLElement): string {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.sr-only').forEach(n => n.remove());
    return c.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

const finalOf = (p: Prediction, away: number, home: number): LiveGame => ({
    id: p.id,
    state: 'OFF',
    period: 3,
    periodType: 'REG',
    clock: '00:00',
    intermission: false,
    lastPeriodType: 'REG',
    away: { score: away, sog: 20 },
    home: { score: home, sog: 25 },
});

describe('G1-2 goalie rating headline', () => {
    it('is neutral and tagged below the small-sample gate, coloured from it', () => {
        expect(SMALL_SAMPLE_GP).toBe(5);
        expect(gsaxHeadline(-0.13, 0)).toEqual({ tone: 'neutral', prior: true });
        expect(gsaxHeadline(0.15, 4)).toEqual({ tone: 'neutral', prior: true });
        expect(gsaxHeadline(0.15, 5)).toEqual({ tone: 'pos', prior: false });
        expect(gsaxHeadline(-0.13, 12)).toEqual({ tone: 'neg', prior: false });
        expect(gsaxHeadline(0.02, 12)).toEqual({ tone: 'neutral', prior: false });
        expect(windowTag('2024-25 to 2025-26')).toBe('24-26');
        expect(windowTag('2025-26')).toBe('25-26');
        expect(windowTag(null)).toBeNull();
    });

    it('renders Silovs / Vladar in fg-1 with a season tag at 0 GP, and colour at 5 GP', () => {
        const p = withOverrides(pitPhi, {}, { away: { gsax: -0.13, goalieCurGp: 0 }, home: { gsax: 0.15, goalieCurGp: 0 } });
        const view = (name: string | null, v: number) => ({ name: name ?? 'X', starter: true, cur: null, prev: null, gsaxPerGame: v, gsaxSeason: '2024-25 to 2025-26', injury: null });
        const data = { away: { goalies: [view(p.away.goalie, -0.13)] }, home: { goalies: [view(p.home.goalie, 0.15)] } } as unknown as GameDetails;
        const el = render(<GoaliesPanel p={p} state={{ status: 'ready', data }} />).container;
        const heads = [...el.querySelectorAll('[data-gsax-headline]')];
        expect(heads).toHaveLength(2);
        for (const h of heads) {
            expect(h.className).toContain('text-fg-1');
            expect(h.className).not.toMatch(/text-(pos|neg)\b/);
            expect(h.parentElement?.textContent).toContain('24-26');
        }
        cleanup();
        const played = withOverrides(p, {}, { away: { gsax: -0.13, goalieCurGp: 5 }, home: { gsax: 0.15, goalieCurGp: 5 } });
        const el2 = render(<GoaliesPanel p={played} state={{ status: 'ready', data }} />).container;
        const [a, h] = [...el2.querySelectorAll('[data-gsax-headline]')];
        expect(a.className).toContain('text-neg');
        expect(h.className).toContain('text-pos');
        expect(a.parentElement?.textContent).not.toContain('24-26');
    });

    it('keeps every Goalies-tab caption to 3 words or fewer', () => {
        const el = render(<GoaliesPanel p={pitPhi} state={{ status: 'ready', data: null }} />).container;
        const captions = [...el.querySelectorAll('dt, .text-micro, .label')].map(n => visible(n as HTMLElement).replace(/[·|]/g, ' ').trim());
        for (const c of captions) expect(c.split(/\s+/).filter(Boolean).length, c).toBeLessThanOrEqual(3);
        expect(shortAge(new Date(Date.now() - 5 * 3600_000).toISOString(), new Date())).toBe('5h');
    });
});

describe('G1-1 Lines tab season tag', () => {
    const side = (grade: boolean) =>
        ({
            lines: { f1: [{ playerId: 1, name: 'A B', display: 'B', pos: 'C', ppUnit: null, movement: null, impact: 0.4 }] },
            lineImpacts: { f1: null },
            grade: grade ? { value: 6.7, rank: 4, outOf: 32 } : null,
            lineupSource: null,
            lineupUpdatedAt: null,
            injuries: [],
            goalies: [],
            recent: [],
            news: [],
        }) as unknown as GameDetails['home'];

    it('shows the prior-season tag beside GRADE, once per visible panel, and marks unrated line totals', () => {
        const data = { away: side(true), home: side(true), impactSeason: '20252026', picks: {} } as unknown as GameDetails;
        const el = render(<LineupsPanel p={pitPhi} state={{ status: 'ready', data }} />).container;
        const tags = [...el.querySelectorAll('span.border-mute')].filter(s => s.textContent?.startsWith('25-26'));
        // Away grid's tag always; the home grid's is hidden on a wide card (both grids show there).
        expect(tags).toHaveLength(2);
        expect(tags.filter(t => !t.className.includes('cq-lg:hidden'))).toHaveLength(1);
        expect(el.querySelector('[title="unrated"]')?.textContent).toContain('—');
    });

    it('drops the tag once the ratings are this season', () => {
        const data = { away: side(true), home: side(true), impactSeason: SEASON_ID, picks: {} } as unknown as GameDetails;
        const el = render(<LineupsPanel p={pitPhi} state={{ status: 'ready', data }} />).container;
        expect(el.textContent).not.toContain('25-26');
    });
});

describe('G1-7 goalie status glyph', () => {
    it('draws a dot for confirmed, a ring for likely and nothing for projected, with no words', () => {
        const p = withOverrides(pitPhi, {}, { away: { goalieStatus: 'Likely' }, home: { goalieStatus: 'Confirmed' } });
        const el = card(p);
        expect(el.querySelector('[data-goalie-glyph="likely"]')?.className).toContain('border-current');
        expect(el.querySelector('[data-goalie-glyph="conf"]')?.className).toContain('bg-current');
        expect(el.querySelector('[data-goalie-glyph]')?.getAttribute('aria-hidden')).toBe('true');
        cleanup();
        const proj = withOverrides(pitPhi, {}, { away: { goalieStatus: 'Unconfirmed' }, home: { goalieStatus: 'Unconfirmed' } });
        expect(card(proj).querySelector('[data-goalie-glyph]')).toBeNull();
    });
});

describe('G1-8 / G1-11 collapsed card', () => {
    it('names both teams by tricode in visible text', () => {
        for (const p of opening) {
            const el = card(p);
            const tris = [...el.querySelectorAll('[data-tri]')].map(n => n.textContent);
            expect(tris).toEqual([p.away.team.triCode, p.home.team.triCode]);
            cleanup();
        }
    });

    it('keeps the h2 to the matchup name and no "@" in accessible names', () => {
        for (const p of opening) {
            const el = card(p, finalOf(p, 2, 3));
            const h2 = el.querySelector('h2')!;
            const name = visible(h2) + [...h2.querySelectorAll('.sr-only')].map(n => n.textContent).join('');
            expect(h2.textContent!.length, h2.textContent!).toBeLessThanOrEqual(60);
            expect(name).not.toContain('Follow');
            const labelled = el.querySelector('article')!.getAttribute('aria-labelledby')!.split(' ');
            const accName = labelled.map(id => el.querySelector(`[id="${id}"]`)?.textContent ?? '').join(' ');
            expect(accName).toContain(' win ');
            expect(accName).not.toContain('@');
            cleanup();
        }
    });

    it('tags LIVE footer odds as pregame', () => {
        const live: LiveGame = { ...finalOf(pitPhi, 1, 1), state: 'LIVE', clock: '12:00', period: 2 };
        const el = card(pitPhi, live);
        expect(visible(el)).toContain('Pre');
        expect(el.textContent).toContain('Pregame odds');
    });

    it('YOUR TEAM strip spells out playoffs and reads "at", not "@"', () => {
        const el = render(<YourTeamStrip favorites={['PIT']} predictions={[pitPhi]} live={{}} today={pitPhi.date} playoffOdds={{ PIT: 70 }} onJump={() => {}} />).container;
        expect(visible(el)).toContain('Playoffs 70%');
        expect(visible(el)).not.toMatch(/\bPO\b/);
        const btn = el.querySelector('button')!;
        const spoken = btn.cloneNode(true) as HTMLElement;
        spoken.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove());
        expect(spoken.textContent).not.toContain('@');
    });
});

describe('G1-9 coin flips', () => {
    it('shows NO LEAN and one decimal on a 50.3% final', () => {
        expect(isCoinFlip(50.3)).toBe(true);
        expect(isCoinFlip(49.2)).toBe(true);
        expect(isCoinFlip(51)).toBe(false);
        const g: ArchiveGame = {
            id: '2026020003',
            date: '2026-09-29',
            startTimeUtc: '2026-09-30T00:00:00Z',
            state: 'OFF',
            lastPeriodType: 'REG',
            away: { tri: 'NYR', name: 'Rangers', score: 0 },
            home: { tri: 'BOS', name: 'Bruins', score: 3 },
            pick: { tri: 'BOS', pct: 50.3, correct: true },
        };
        const el = render(<ArchiveCard g={g} />).container;
        const t = visible(el);
        expect(t).toContain('No lean');
        expect(t).not.toContain('✓');
        expect(t).toContain('50.3');
        expect(t).toContain('49.7');
    });

    it('does the same on a live-file final', () => {
        const p = withOverrides(pitPhi, { status: 'frozen' }, { home: { winPct: 50.3 }, away: { winPct: 49.7 } });
        const t = visible(card(p, finalOf(p, 1, 4)));
        expect(t).toContain('No lean');
        expect(t).not.toMatch(/[✓✕]/);
    });
});

describe('G1-10 glossary links', () => {
    it('links the legend to Reading a card and chips / tiles to glossary anchors', () => {
        expect(READING_HREF).toBe('/methodology#reading');
        const legend = render(<WinBarLegend href={READING_HREF} />).container.querySelector('a')!;
        expect(legend.getAttribute('href')).toBe('/methodology#reading');
        expect(visible(legend)).toBe('Market Model');
        cleanup();
        expect(termHref('b2b')).toBe('/methodology#term-rest');
        expect(termHref('conf')).toBe('/methodology#term-confidence');
        expect(termHref('nope')).toBeNull();
        expect(CARD_ANCHORS).toContain('term-opener');

        const b2b = withOverrides(pitPhi, {}, { home: { isB2b: true, gp: 1 } });
        const chips = render(<ContextChips p={b2b} />).container;
        const hrefs = [...chips.querySelectorAll('a')].map(a => a.getAttribute('href'));
        expect(hrefs).toContain('/methodology#term-rest');
        cleanup();

        const why = render(<WhyPanel p={withOverrides(pitPhi, { blendWeight: 0.2, confidenceGrade: null })} phase="pre" state={{ status: 'loading' }} implication={null} />).container;
        const wt = [...why.querySelectorAll('a')].find(a => a.getAttribute('href') === '/methodology#term-wt');
        expect(wt?.getAttribute('title')).toBe('model ×0.20 · market ×0.80');
    });
});

describe('G1-11 document title', () => {
    it('matches the server metadata format', () => {
        expect(slateTitle('2026-10-01', '2026-09-30')).toBe('NHL predictions for Thu, Oct 1 | Pony xG');
    });
});

describe('G1-10 anchors resolve', () => {
    it('every card link lands on a /methodology section or glossary term (bar the ones G3 is adding)', () => {
        const page = readFileSync(resolve(__dirname, '../../../app/methodology/page.tsx'), 'utf8');
        const sections = new Set([...page.matchAll(/(?:Section|section|p) id="([a-z0-9-]+)"/g)].map(m => m[1]));
        const terms = new Set(GLOSSARY_TERMS.map(k => `term-${k}`));
        expect(sections.has('reading')).toBe(true);
        const missing = CARD_ANCHORS.filter(a => !sections.has(a) && !terms.has(a));
        for (const a of missing) expect(PENDING_ANCHORS, `${a} does not resolve`).toContain(a);
        // Rest / B2B, confidence, form, special teams, H2H and projected goals resolve today.
        for (const a of ['term-rest', 'term-confidence', 'term-last-n', 'term-pp-pk', 'term-h2h', 'term-projected-goals']) expect(terms.has(a), a).toBe(true);
    });
});
