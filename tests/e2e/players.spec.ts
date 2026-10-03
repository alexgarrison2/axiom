import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { blockingAxeViolations, formatAxe, horizontalOverflow, settle } from './quality';

/**
 * /players: per-game IMPACT (goals per 82 above the position average) headline with
 * OFF / DEF / PEN, then the per-60 rates (public/data/player_ratings.json, v3+).
 * A v2 file (EV per 60 only) still works: the table opens on NET per 60 and the
 * impact-only columns are hidden. The spec reads the served file to know which.
 * PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/players.spec.ts
 */

const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/player_ratings.json'), 'utf8')) as { columns: string[] };
const HAS_IMPACT = doc.columns.includes('impact');
const HAS_PEN = doc.columns.includes('pen_impact');
const HAS_PP = doc.columns.includes('pp_off');
/** The descriptive production score (prod / gs_pg appended to the file): PROD right after the headline. */
const HAS_PROD = HAS_IMPACT && doc.columns.includes('prod');
const HEAD = HAS_IMPACT ? 'IMPACT' : 'NET';

const num = (s: string) => Number(s.replace('−', '-').replace(/[^\d.+-]/g, ''));
const label = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase();

async function heads(page: Page): Promise<string[]> {
    return (await page.locator('thead tr').last().locator('th').allInnerTexts()).map(label);
}

async function column(page: Page, name: string): Promise<string[]> {
    const h = await heads(page);
    const i = h.indexOf(name);
    expect(i, `${name} in ${h.join(',')}`).toBeGreaterThan(0);
    return page.locator(`tbody tr > :nth-child(${i + 1})`).allInnerTexts();
}

/** Rating columns this file has (the rest are hidden), in table order. */
const RATING_COLS = [
    ...(HAS_PROD ? ['PROD'] : []),
    ...(HAS_IMPACT ? ['OFF', 'DEF'] : []),
    ...(HAS_PEN ? ['PEN'] : []),
    'EV OFF',
    'EV DEF',
    ...(HAS_PP ? ['PP', 'PK'] : []),
    'FIN',
    'EV MIN',
];
/** The phone column set that shows a column. */
const SET_OF: Record<string, string> = { OFF: 'impact', DEF: 'impact', PEN: 'impact', PROD: 'scoring' };

test.describe('/players', () => {
    test(`ranks skaters by ${HEAD}, best first, with the impact and per-60 columns`, async ({ page, isMobile }) => {
        const urls: string[] = [];
        page.on('request', r => urls.push(r.url()));
        await page.goto('/players');
        await settle(page);
        await expect(page.getByRole('columnheader', { name: new RegExp(`^${HEAD}`) })).toHaveAttribute('aria-sort', 'descending');
        const h = await heads(page);
        expect(h.slice(0, 2 + RATING_COLS.length)).toEqual(['PLAYER', HEAD, ...RATING_COLS]);
        expect(h.slice(2 + RATING_COLS.length)).toEqual(['GP', 'G', 'A', 'PTS', 'TOI', 'SOG/GP']);
        for (const gone of ['OFF+FIN', 'IXG/60']) expect(h).not.toContain(gone);
        const top = (await column(page, HEAD)).map(num);
        expect(top.length).toBe(50);
        for (let i = 1; i < top.length; i++) expect(top[i]).toBeLessThanOrEqual(top[i - 1]);
        const names = (await page.locator('tbody th[scope="row"]').allInnerTexts()).slice(0, 20).join(' ');
        for (const n of ['McDavid', 'MacKinnon', 'Matthews']) expect(names).toContain(n);
        await expect(page.locator('body')).toContainText(/\d{3} skaters/i);
        expect(urls.filter(u => u.includes('player_impact.json'))).toHaveLength(0);
        if (isMobile) await expect(page.getByLabel('Columns')).toHaveValue(HAS_IMPACT ? 'impact' : 'rates');
    });

    test(`${HEAD} adds up: ${HAS_IMPACT ? 'IMPACT = OFF + DEF (goals / 82)' : 'NET = EV OFF + EV DEF (per 60)'}`, async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        const [a, b, tol] = HAS_IMPACT ? ['OFF', 'DEF', 0.151] : ['EV OFF', 'EV DEF', 0.011];
        const head = (await column(page, HEAD)).map(num);
        const x = (await column(page, a)).map(num);
        const y = (await column(page, b)).map(num);
        for (let i = 0; i < 20; i++) expect(Math.abs(x[i] + y[i] - head[i])).toBeLessThanOrEqual(tol);
    });

    test('every rating column sorts best first, then toggles to worst first', async ({ page, isMobile }) => {
        await page.goto('/players');
        await settle(page);
        const headBtn = page.getByRole('button', { name: HEAD, exact: true });
        await headBtn.click();
        await expect(page.getByRole('columnheader', { name: new RegExp(`^${HEAD}`) })).toHaveAttribute('aria-sort', 'ascending');
        const asc = (await column(page, HEAD)).map(num);
        for (let i = 1; i < asc.length; i++) expect(asc[i]).toBeGreaterThanOrEqual(asc[i - 1]);
        for (const name of RATING_COLS.filter(c => c !== 'EV MIN')) {
            if (isMobile) await page.getByLabel('Columns').selectOption(SET_OF[name] ?? 'rates');
            const btn = page.getByRole('button', { name, exact: true });
            const th = page.locator('thead tr').last().locator('th', { has: btn });
            await btn.click();
            await expect(th).toHaveAttribute('aria-sort', 'descending');
            const desc = (await column(page, name)).filter(t => t.trim() !== '—').map(num);
            expect(desc.length, name).toBeGreaterThan(40);
            for (let i = 1; i < desc.length; i++) expect(desc[i], `${name} row ${i}`).toBeLessThanOrEqual(desc[i - 1]);
            expect(desc[0], name).toBeGreaterThan(0);
            await btn.click();
            await expect(th).toHaveAttribute('aria-sort', 'ascending');
            const up = (await column(page, name)).filter(t => t.trim() !== '—').map(num);
            for (let i = 1; i < up.length; i++) expect(up[i], `${name} row ${i}`).toBeGreaterThanOrEqual(up[i - 1]);
            expect(up[0], name).toBeLessThan(0);
        }
    });

    test('a strong defensive forward shows a positive, green DEF', async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        await page.getByPlaceholder('SEARCH').fill('Mark Stone');
        const name = HAS_IMPACT ? 'DEF' : 'EV DEF';
        const h = await heads(page);
        const row = page.locator('tbody tr', { has: page.locator('th[scope="row"]', { hasText: 'Mark Stone' }) });
        const cell = row.locator(`> :nth-child(${h.indexOf(name) + 1}) span`).first();
        await expect(cell).toHaveText(/^\+\d+\.\d/);
        await expect(cell).toHaveClass(/text-pos/);
    });

    test('group headers, filters and the counting-stat season toggle', async ({ page, isMobile }) => {
        test.skip(isMobile, 'desktop: the group header row shows on wide screens');
        await page.goto('/players');
        await settle(page);
        const groups = page.locator('thead th[scope="colgroup"]');
        await expect(groups.first()).toContainText(HAS_PROD ? 'PER 82' : HAS_IMPACT ? 'GOALS / 82' : 'EV / 60');
        await expect(groups.first()).toContainText(/· [A-Z]{3} \d{1,2}/);
        await expect(groups.nth(1)).toHaveText('PER 60');
        await page.getByRole('button', { name: 'D', exact: true }).click();
        const pos = await page.locator('tbody th[scope="row"]').allInnerTexts();
        for (const t of pos) expect(t.trim()).toMatch(/\bD( R)?$/);
        await page.getByRole('radio', { name: /2025-26 counting stats/ }).click();
        await expect(groups.last()).toHaveText('2025-26');
        await page.getByRole('button', { name: 'PTS', exact: true }).click();
        const pts = (await column(page, 'PTS')).map(num);
        expect(pts[0]).toBeGreaterThan(30); // a full season of a top defenceman
    });

    test('is accessible and fits a phone', async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
});

test.describe('/players at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('every column set fits without page overflow', async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        const sets = page.getByLabel('Columns');
        const options = await sets.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
        expect(options).toEqual(HAS_IMPACT ? ['impact', 'rates', 'scoring'] : ['rates', 'scoring']);
        for (const s of options) {
            await sets.selectOption(s);
            const visible = (await page.locator('thead tr').last().locator('th:visible').allInnerTexts()).map(label);
            expect(visible.slice(0, 2), s).toEqual(['PLAYER', HEAD]);
            if (s === 'impact') expect(visible).toEqual(['PLAYER', HEAD, 'OFF', 'DEF', ...(HAS_PEN ? ['PEN'] : [])]);
            if (s === 'scoring' && HAS_PROD) expect(visible[2], s).toBe('PROD');
            expect(await horizontalOverflow(page), s).toBeLessThanOrEqual(1);
        }
    });
});
