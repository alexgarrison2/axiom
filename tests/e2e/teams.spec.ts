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

    test('column headers stay visible after scrolling', async ({ page }) => {
        await page.goto('/teams?season=20252026');
        await expect(page.locator('caption').first()).toContainText('2025-26 regular season');
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(300);
        const head = page.getByRole('columnheader', { name: /^GP/ }).first();
        const box = await head.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeLessThan(200);
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
