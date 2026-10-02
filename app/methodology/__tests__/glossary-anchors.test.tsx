import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GLOSSARY, GLOSSARY_ANCHORS, GLOSSARY_TERMS, glossaryHref, glossaryIds } from '@/lib/glossary';

vi.mock('server-only', () => ({}));

/**
 * Anchors the matchup card's chips and legend link to (fix round 3, G1-10:
 * lib/matchup/glossary-links.ts CARD_TERMS), plus the tags G3 adds.
 */
const CARD_ANCHORS = [
    'term-b2b',
    'term-lean',
    'term-opener',
    'term-wt',
    'term-po',
    'term-legacy',
    'term-conf',
    'term-n',
    'term-h2h',
    'term-last-n',
    'term-pp-pk',
    'term-rest',
    'term-projected-goals',
    'term-dfo',
    // fix4: /accuracy labels, the card's lean flag and the Odds tab link here.
    'term-no-lean',
    'term-no-pick',
    'term-back-filled',
    'term-disclaimer',
    'term-gate',
    'term-brier',
    'term-log-loss',
    'term-fair-odds',
    'term-edge',
    // Odds tab: the game simulator's markets.
    'term-simulator',
    'term-reg-3way',
    'term-p1-2way',
    'term-push',
    'term-fair-price',
    'term-sim-edge',
];

async function renderPage(): Promise<string> {
    const { default: MethodologyPage } = await import('../page');
    return renderToStaticMarkup(MethodologyPage());
}

describe('/methodology glossary anchors', () => {
    it('lists an anchor for every chip the card links to', () => {
        for (const a of CARD_ANCHORS) expect(GLOSSARY_ANCHORS, a).toContain(a);
        expect(glossaryHref('b2b')).toBe('/methodology#term-b2b');
    });

    it('never gives two entries the same anchor', () => {
        expect(new Set(GLOSSARY_ANCHORS).size).toBe(GLOSSARY_ANCHORS.length);
    });

    it('renders every anchor exactly once, plus the reading-a-card section', async () => {
        const html = await renderPage();
        for (const a of [...GLOSSARY_ANCHORS, 'reading']) {
            const hits = html.split(`id="${a}"`).length - 1;
            expect(hits, a).toBe(1);
        }
    });

    it('defines EV with the published forecast and 1u as 1% of bankroll', async () => {
        expect(GLOSSARY.edge.detail).toMatch(/forecast probability × decimal odds − 1/);
        expect(GLOSSARY.edge.detail).not.toMatch(/model probability/);
        expect(GLOSSARY.units.short).toMatch(/1% of bankroll/);
        const html = await renderPage();
        expect(html).toMatch(/EV = forecast probability × decimal odds − 1/);
        expect(html).toMatch(/1 unit \(1u\) = 1% of bankroll/);
        expect(html).not.toMatch(/rest and travel/);
    });

    it('defines NET = OFF + DEF exactly as the published ratings file computes it', async () => {
        type Doc = { columns: string[]; rows: unknown[][] };
        const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8')) as Doc;
        const c = (k: string) => doc.columns.indexOf(k);
        expect(doc.rows.length).toBeGreaterThan(700);
        for (const r of doc.rows) expect(Math.abs((r[c('off')] as number) + (r[c('def')] as number) - (r[c('net')] as number))).toBeLessThan(0.002);
        expect(GLOSSARY['player-net'].detail).toMatch(/NET = OFF \+ DEF/);
        expect(GLOSSARY['player-def'].short).toMatch(/Higher is better/);
        expect(GLOSSARY['player-def'].short).not.toMatch(/Lower is better/);
        // The old composite is gone from the glossary and the page.
        expect(Object.keys(GLOSSARY)).not.toContain('player-impact');
        const html = await renderPage();
        expect(html).not.toMatch(/50\/20\/20\/10|standard deviations from the average player/);
        expect(html).toMatch(/NET<\/strong> = OFF \+ DEF/);
        expect(html).not.toMatch(/xG against, lower is better/);
        expect(html).toMatch(/DEF<\/strong> \(xG against prevented\)/);
    });

    it('defines OFF+FIN = OFF + FIN and keeps FIN out of NET', async () => {
        type Doc = { columns: string[]; rows: unknown[][] };
        const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8')) as Doc;
        const c = (k: string) => doc.columns.indexOf(k);
        if (c('fin') >= 0 && c('off_total') >= 0) {
            for (const r of doc.rows) expect(Math.abs((r[c('off')] as number) + (r[c('fin')] as number) - (r[c('off_total')] as number))).toBeLessThan(0.002);
        }
        expect(GLOSSARY['player-fin'].label).toBe('FIN');
        expect(GLOSSARY['player-off-fin'].label).toBe('OFF+FIN');
        expect(GLOSSARY['player-fin'].short).toMatch(/Not part of NET/);
        expect(GLOSSARY_ANCHORS).toEqual(expect.arrayContaining(['term-player-fin', 'term-player-off-fin']));
        const html = await renderPage();
        expect(html).toMatch(/OFF\+FIN<\/strong> = OFF \+ FIN/);
    });

    it('keeps every term id addressable', () => {
        for (const t of GLOSSARY_TERMS) expect(glossaryIds(t)[0]).toBe(t);
    });
});
