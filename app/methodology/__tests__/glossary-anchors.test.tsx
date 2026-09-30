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

    it('states the Impact formula so every published score can be reproduced', () => {
        type P = { name: string; is_forward: boolean; impact_ev_off: number; impact_ev_def: number; impact_pp: number; impact_pk: number; impact_score: number };
        const players = Object.values(JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_impact.json'), 'utf8')) as Record<string, P>).filter(
            p => typeof p.impact_score === 'number',
        );
        expect(players.length).toBeGreaterThan(100);
        for (const p of players) {
            const w = p.is_forward ? [0.5, 0.2, 0.2, 0.1] : [0.25, 0.4, 0.15, 0.2];
            const v = w[0] * p.impact_ev_off + w[1] * p.impact_ev_def + w[2] * p.impact_pp + w[3] * p.impact_pk;
            expect(Math.abs(v - p.impact_score), p.name).toBeLessThan(0.003);
        }
        // Spot check: Jordan Staal 0.50×6.048 + 0.20×2.715 + 0.20×0.558 + 0.10×(−1.953) = 3.483.
        const staal = players.find(p => p.name === 'Jordan Staal');
        if (staal) expect(staal.impact_score).toBeCloseTo(0.5 * staal.impact_ev_off + 0.2 * staal.impact_ev_def + 0.2 * staal.impact_pp + 0.1 * staal.impact_pk, 2);
        expect(GLOSSARY['player-impact'].detail).toMatch(/0\.50 EV OFF \+ 0\.20 EV DEF \+ 0\.20 PP \+ 0\.10 PK/);
        expect(GLOSSARY['player-impact'].short).not.toMatch(/per 60/);
    });

    it('keeps every term id addressable', () => {
        for (const t of GLOSSARY_TERMS) expect(glossaryIds(t)[0]).toBe(t);
    });
});
