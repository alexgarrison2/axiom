import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * /accuracy honesty rules (fix round 3, G3).
 * PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/accuracy.spec.ts
 */

const report = JSON.parse(readFileSync(join(process.cwd(), 'public/data/model_report.json'), 'utf8'));
const CURRENT: string = report.current_season;
const curN: number = report.seasons?.[CURRENT]?.all?.n ?? 0;

const reportCard = (page: Page) => page.locator('section[aria-labelledby="report-card"]');

test.describe('/accuracy', () => {
    test('a failed picks fetch says UNAVAILABLE and retry recovers', async ({ page }) => {
        let fail = true;
        await page.route('**/accuracy/games/**', route => (fail ? route.fulfill({ status: 500, body: 'boom' }) : route.continue()));
        await page.goto('/accuracy');
        const picks = page.locator('section[aria-labelledby="every-pick"]');
        await expect(picks.getByRole('alert')).toContainText(/unavailable/i);
        await expect(picks).not.toContainText(/0 graded/i);
        fail = false;
        await picks.getByRole('button', { name: /retry/i }).click();
        await expect(picks.getByRole('alert')).toHaveCount(0);
        if (curN > 0) await expect(picks.locator('ul li').first()).toBeVisible();
    });

    test('small samples: no market delta, no verdict, no coloured ledger', async ({ page }) => {
        test.skip(curN === 0 || curN >= 100, 'needs a current season with 1-99 graded games');
        await page.goto('/accuracy');
        const card = reportCard(page);
        await expect(card.getByTestId('accuracy-verdict')).toHaveText(/too early/i);
        await expect(card).not.toContainText(/vs mkt/i);
        await expect(card).not.toContainText(/model better|beats model/i);
        const ledger = page.locator('#ledger');
        await expect(ledger).not.toContainText(/CI [+−-]/);
        await expect(ledger.locator('.text-pos, .text-neg')).toHaveCount(0);
    });

    test('2025-26 reads VS MARKET WORSE · VS HOME BETTER', async ({ page }) => {
        await page.goto('/accuracy?season=2025-26');
        const v = reportCard(page).getByTestId('accuracy-verdict');
        await expect(v).toContainText(/vs market\s*worse/i);
        await expect(v).toContainText(/vs home\s*better/i);
        // Every VS-table cell is filled (no '—' Brier on the market-games row).
        const brier = reportCard(page).locator('table tbody tr td:nth-child(4)');
        const texts = await brier.allTextContents();
        expect(texts.filter(t => t.trim() === '—')).toEqual([]);
    });

    test('no layout shift when the picks load (desktop)', async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'desktop footer is in view at 1440×900');
        await page.addInitScript(() => {
            // @ts-expect-error test global
            window.__cls = 0;
            new PerformanceObserver(list => {
                for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
                    // @ts-expect-error test global
                    if (!e.hadRecentInput) window.__cls += e.value;
            }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.goto('/accuracy');
        await page.locator('section[aria-labelledby="every-pick"] [aria-busy]').waitFor({ state: 'detached' }).catch(() => {});
        await page.waitForTimeout(800);
        // @ts-expect-error test global
        const cls = await page.evaluate(() => window.__cls as number);
        expect(cls).toBeLessThan(0.05);
    });
});
