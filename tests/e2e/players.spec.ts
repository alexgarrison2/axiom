import { test, expect, type Page } from '@playwright/test';
import { blockingAxeViolations, formatAxe, horizontalOverflow, settle } from './quality';

/**
 * /players: the RAPM v2 ratings (OFF / DEF / NET per 60, public/data/player_ratings.json)
 * replace the old Impact composite.
 * PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/players.spec.ts
 */

const num = (s: string) => Number(s.replace('−', '-').replace(/[^\d.+-]/g, ''));

async function column(page: Page, label: string): Promise<string[]> {
    const heads = (await page.locator('thead tr').last().locator('th').allInnerTexts()).map(t => t.trim().split(/\s/)[0].toUpperCase());
    const i = heads.indexOf(label);
    expect(i, `${label} in ${heads.join(',')}`).toBeGreaterThan(0);
    return page.locator(`tbody tr > :nth-child(${i + 1})`).allInnerTexts();
}

test.describe('/players', () => {
    test('ranks skaters by NET, best first, with OFF / DEF and no old composite', async ({ page }) => {
        const urls: string[] = [];
        page.on('request', r => urls.push(r.url()));
        await page.goto('/players');
        await settle(page);
        const net = page.getByRole('columnheader', { name: /^NET/ });
        await expect(net).toHaveAttribute('aria-sort', 'descending');
        const heads = (await page.locator('thead tr').last().locator('th').allInnerTexts()).map(t => t.trim().split(/\s/)[0].toUpperCase());
        expect(heads.slice(0, 4)).toEqual(['PLAYER', 'NET', 'OFF', 'DEF']);
        const full = (await page.locator('thead').innerText()).toUpperCase();
        for (const old of ['IMPACT', 'EV OFF', 'EV DEF', 'PP', 'PK', 'IXG/60']) expect(full).not.toMatch(new RegExp(`(^|\\s)${old.replace('/', '\\/')}(\\s|$)`));
        const nets = (await column(page, 'NET')).map(num);
        expect(nets.length).toBe(50);
        for (let i = 1; i < nets.length; i++) expect(nets[i]).toBeLessThanOrEqual(nets[i - 1]);
        const names = await page.locator('tbody th[scope="row"]').allInnerTexts();
        const top15 = names.slice(0, 15).join(' ');
        for (const n of ['McDavid', 'MacKinnon', 'Matthews']) expect(top15).toContain(n);
        await expect(page.locator('body')).toContainText(/\d{3} skaters/i);
        expect(urls.filter(u => u.includes('player_impact.json'))).toHaveLength(0);
    });

    test('DEF sorts lowest (best) first and NET = OFF − DEF', async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        await page.getByRole('button', { name: /^DEF/ }).click();
        await expect(page.getByRole('columnheader', { name: /^DEF/ })).toHaveAttribute('aria-sort', 'ascending');
        const def = (await column(page, 'DEF')).map(num);
        for (let i = 1; i < def.length; i++) expect(def[i]).toBeGreaterThanOrEqual(def[i - 1]);
        const off = (await column(page, 'OFF')).map(num);
        const net = (await column(page, 'NET')).map(num);
        for (let i = 0; i < 10; i++) expect(Math.abs(off[i] - def[i] - net[i])).toBeLessThanOrEqual(0.011);
    });

    test('filters and the counting-stat season toggle', async ({ page, isMobile }) => {
        test.skip(isMobile, 'desktop: the group header row shows on wide screens');
        await page.goto('/players');
        await settle(page);
        await page.getByRole('button', { name: 'D', exact: true }).click();
        const pos = await page.locator('tbody th[scope="row"]').allInnerTexts();
        for (const t of pos) expect(t.trim()).toMatch(/\bD( R)?$/);
        await page.getByRole('radio', { name: /2025-26 counting stats/ }).click();
        await expect(page.locator('thead th[scope="colgroup"]').last()).toHaveText('2025-26');
        await page.getByRole('button', { name: /^PTS/ }).click();
        const pts = (await column(page, 'PTS')).map(num);
        expect(pts[0]).toBeGreaterThan(30); // a full season of a top defenceman
        await expect(page.locator('thead th[scope="colgroup"]').first()).toContainText(/RAPM/);
    });

    test('is accessible and fits a phone', async ({ page }) => {
        await page.goto('/players');
        await settle(page);
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
});
