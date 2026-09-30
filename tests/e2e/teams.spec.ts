import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Teams table and team pages (workstream F).
 * PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/teams.spec.ts
 */

const AXE_SRC = readFileSync(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');

async function axeSerious(page: Page) {
    await page.addScriptTag({ content: AXE_SRC });
    return page.evaluate(async () => {
        // @ts-expect-error injected global
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations
            .filter((v: { impact: string }) => v.impact === 'serious' || v.impact === 'critical')
            .map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
    });
}

test.describe('/teams', () => {
    test('shows this season by default, never last season plus playoffs', async ({ page }) => {
        await page.goto('/teams');
        const caption = page.locator('caption').first();
        await expect(caption).toContainText(/\d{4}-\d{2} regular season/);
        await expect(caption).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Olympics');
        // No team can have more regular-season games than the schedule allows.
        const gp = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
        for (const v of gp) expect(Number(v) || 0).toBeLessThanOrEqual(84);
    });

    test('2025-26 matches the final NHL standings', async ({ page }) => {
        await page.goto('/teams?season=20252026');
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        const car = page.locator('tbody tr', { has: page.locator('a[href="/teams/CAR"]') });
        await expect(car.locator('td').nth(1)).toHaveText('82');
        await expect(car.locator('td').nth(2)).toHaveText('53');
        await expect(car.locator('td').nth(3)).toHaveText('22');
        await expect(car.locator('td').nth(4)).toHaveText('7');
        await expect(car.locator('td').nth(5)).toHaveText('113');
    });

    test('a shared ?season= link is prerendered, not swapped in after hydration', async ({ request }) => {
        const html = (await (await request.get('/teams?season=20252026')).text()).replace(/<!-- -->/g, '');
        const caption = html.match(/<caption[^>]*>(.*?)<\/caption>/)?.[1].replace(/<[^>]+>/g, '') ?? '';
        expect(caption).toContain('2025-26 regular season');
        expect(caption).toContain('through 82 games');
    });

    test('no clinch or elimination codes before they belong to this season', async ({ page }) => {
        await page.goto('/teams');
        for (const label of ['Eliminated', 'Clinched playoff spot', 'Clinched division', "Presidents' Trophy"]) {
            await expect(page.locator(`[title="${label}"]`)).toHaveCount(0);
        }
    });

    test('re-visiting /teams in-session makes no new data requests', async ({ page }) => {
        await page.goto('/teams');
        await page.getByRole('radio', { name: '2025-26' }).first().click();
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        await page.getByRole('radio', { name: '2026-27' }).first().click();
        const data: string[] = [];
        page.on('request', r => {
            if (/\/api\/|\/data\//.test(r.url())) data.push(r.url());
        });
        await page.getByRole('radio', { name: '2025-26' }).first().click();
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        await page.locator('a[href="/teams/EDM"]').first().click();
        await expect(page).toHaveURL(/\/teams\/EDM/);
        await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Teams' }).click();
        await expect(page).toHaveURL(/\/teams$/);
        await page.getByRole('radio', { name: '2025-26' }).first().click();
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        expect(data).toEqual([]);
    });

    test('column headers stay visible after scrolling', async ({ page }) => {
        await page.goto('/teams?season=20252026');
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        // Streamed static HTML reveals the table on React's next reveal tick.
        await expect(page.locator('caption').first()).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 900));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
        const head = page.getByRole('columnheader', { name: /^GP/ }).first();
        // The header follows the page once hydrated (it re-measures on mount).
        await expect.poll(async () => (await head.boundingBox())?.y ?? -1, { timeout: 5000 }).toBeGreaterThanOrEqual(0);
        await expect.poll(async () => (await head.boundingBox())?.y ?? 9999, { timeout: 5000 }).toBeLessThan(200);
    });

    test('axe: 0 serious/critical', async ({ page }) => {
        await page.goto('/teams');
        expect(await axeSerious(page)).toEqual([]);
    });
});

test.describe('/teams/[abbr]', () => {
    test('unknown team is a 404 with the site nav', async ({ page }) => {
        const res = await page.goto('/teams/XYZ');
        expect(res?.status()).toBe(404);
        await expect(page.getByRole('banner')).toBeVisible();
    });

    test('hero is the first thing on the page', async ({ page }) => {
        await page.goto('/teams/EDM');
        const h1 = page.getByRole('heading', { level: 1, name: 'Edmonton Oilers' });
        await expect(h1).toBeVisible();
        const box = await h1.boundingBox();
        expect(box!.y).toBeLessThan(400);
        await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Teams');
    });

    test('2025-26 regular-season totals exclude the playoffs', async ({ page }) => {
        await page.goto('/teams/EDM?season=20252026');
        const summary = page.getByRole('tabpanel');
        await expect(summary).toContainText('41-30-11');
        await expect(summary).toContainText('93');
        await expect(summary).toContainText('82 of 82 games');
    });

    test('skaters come from the current roster with season-consistent lines', async ({ request }) => {
        const res = await request.get('/api/teams/EDM/stats');
        const body = await res.json();
        const names: string[] = body.skaters.map((s: { name: string }) => s.name);
        for (const gone of ['Darnell Nurse', 'Adam Henrique', 'Jack Roslovic']) expect(names).not.toContain(gone);
        const mcd = body.skaters.find((s: { name: string }) => s.name === 'Connor McDavid');
        expect(mcd.last).toMatchObject({ gp: 82 });
        expect(mcd.last.pts).toBeGreaterThan(0);
        expect(mcd.current?.gp ?? 0).toBeLessThanOrEqual(1);
        for (const s of body.skaters) for (const line of [s.current, s.last]) if (line) expect(line.pts).toBe(line.g + line.a);
    });

    test('keyboard can sort the game log and expand a row', async ({ page, isMobile }) => {
        test.skip(isMobile, 'the sortable table is the md+ layout; phones get card rows');
        await page.goto('/teams/EDM?season=20252026');
        const sortBtn = page.getByRole('columnheader', { name: /^SF/ }).getByRole('button');
        await sortBtn.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('columnheader', { name: /^SF/ })).toHaveAttribute('aria-sort', 'descending');
        const expand = page.locator('tbody th button[aria-expanded]').first();
        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(expand).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByText(/Skater boxscore|No player boxscore/).first()).toBeAttached();
    });

    test('goalies tab lists roster goalies with season-labelled lines', async ({ page }) => {
        await page.goto('/teams/EDM?tab=goalies');
        await expect(page.getByRole('tab', { name: 'Goalies' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('article').first()).toContainText(/\d{4}-\d{2}/);
        await expect(page.locator('body')).not.toContainText('coming soon');
    });

    test('Points % chart stays within 0-1', async ({ page }) => {
        await page.goto('/teams/EDM?tab=charts&season=20252026');
        await page.locator('figure').first().scrollIntoViewIfNeeded();
        const tick = page.locator('.recharts-yAxis-tick-labels text');
        await expect(tick.first()).toBeAttached();
        const ticks = (await tick.allTextContents()).filter(t => /^[.\d]/.test(t));
        expect(ticks.length).toBeGreaterThan(1);
        const nums = ticks.map(t => Number(t.startsWith('.') ? `0${t}` : t));
        expect(Math.max(...nums)).toBeLessThanOrEqual(1);
    });

    test('team switcher stays on screen and its search does not zoom', async ({ page }) => {
        await page.goto('/teams/EDM');
        await page.getByRole('button', { name: /Switch team/ }).click();
        const panel = page.getByRole('dialog', { name: 'Choose a team' });
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        const vw = page.viewportSize()!.width;
        expect(box!.x + box!.width).toBeLessThanOrEqual(vw - 12 + 0.5);
        const fs = await page.getByRole('searchbox', { name: 'Search teams' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(fs).toBeGreaterThanOrEqual(16);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
    });

    test('tap targets are at least 24px', async ({ page }) => {
        await page.goto('/teams/EDM?season=20252026');
        const small = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('main a, main button, main input, main select, main [role="radio"]')]
                .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
                .map(el => el.getBoundingClientRect())
                .filter(r => r.width > 0 && (r.width < 24 || r.height < 24)).length,
        );
        expect(small).toBe(0);
    });

    test('axe: 0 serious/critical', async ({ page }) => {
        await page.goto('/teams/EDM?season=20252026');
        expect(await axeSerious(page)).toEqual([]);
    });

    test('stats API is small and rejects ALL', async ({ request }) => {
        const ok = await request.get('/api/teams/EDM/stats');
        expect(ok.status()).toBe(200);
        expect((await ok.body()).length).toBeLessThanOrEqual(200_000);
        const all = await request.get('/api/teams/ALL/stats');
        expect(all.status()).toBe(400);
    });
});
