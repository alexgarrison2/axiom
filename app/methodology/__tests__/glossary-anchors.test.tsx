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

    it('defines the even-strength NET = EV OFF + EV DEF exactly as the published ratings file computes it', async () => {
        type Doc = { columns: string[]; rows: unknown[][] };
        const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8')) as Doc;
        const c = (k: string) => doc.columns.indexOf(k);
        expect(doc.rows.length).toBeGreaterThan(700);
        for (const r of doc.rows) expect(Math.abs((r[c('off')] as number) + (r[c('def')] as number) - (r[c('net')] as number))).toBeLessThan(0.002);
        expect(GLOSSARY['player-net'].detail).toMatch(/NET = EV OFF \+ EV DEF/);
        expect(GLOSSARY['player-def'].short).toMatch(/Higher is better/);
        expect(GLOSSARY['player-def'].short).not.toMatch(/Lower is better/);
        const html = await renderPage();
        // The old z-score composite never comes back.
        expect(html).not.toMatch(/50\/20\/20\/10|standard deviations from the average player/);
        expect(html).toMatch(/NET<\/strong> = EV OFF \+ EV DEF/);
        expect(html).not.toMatch(/xG against, lower is better/);
    });

    it('defines IMPACT = OFF + DEF in goals per 82 exactly as the published ratings file computes it', async () => {
        type Doc = { columns: string[]; rows: unknown[][] };
        const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8')) as Doc;
        const c = (k: string) => doc.columns.indexOf(k);
        // v3+ files (2 dp columns); a v2 file has no impact columns yet.
        if (c('impact') >= 0) {
            for (const r of doc.rows) expect(Math.abs((r[c('off_impact')] as number) + (r[c('def_impact')] as number) - (r[c('impact')] as number))).toBeLessThan(0.016);
        }
        expect(GLOSSARY['player-impact'].label).toBe('IMPACT');
        expect(GLOSSARY['player-impact'].short).toMatch(/82 games/);
        expect(GLOSSARY['player-impact'].short).toMatch(/IMPACT = OFF \+ DEF/);
        expect(GLOSSARY['player-impact'].detail).toMatch(/90-game half-life/);
        expect(GLOSSARY['player-off'].short).toMatch(/Goals per 82 games/);
        expect(GLOSSARY['player-pen'].short).toMatch(/inside OFF and DEF/);
        expect(GLOSSARY['player-fin'].short).toMatch(/Part of OFF, not of NET/);
        expect(GLOSSARY['player-prod'].label).toBe('PROD');
        expect(GLOSSARY['player-prod'].short).toMatch(/Game Score/);
        expect(GLOSSARY['player-prod'].short).toMatch(/IMPACT is the predictive rating/);
        expect(GLOSSARY_ANCHORS).toEqual(expect.arrayContaining(['term-player-impact', 'term-player-off', 'term-player-def', 'term-player-pen', 'term-player-rates', 'term-player-fin']));
        expect(Object.keys(GLOSSARY)).not.toContain('player-off-fin');
        const html = await renderPage();
        expect(html).toMatch(/IMPACT<\/strong> = OFF \+ DEF/);
        expect(html).toMatch(/90-game half-life/);
        expect(html).not.toMatch(/OFF\+FIN/);
    });

    it('keeps every term id addressable', () => {
        for (const t of GLOSSARY_TERMS) expect(glossaryIds(t)[0]).toBe(t);
    });
});
