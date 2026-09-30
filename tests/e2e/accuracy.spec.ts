import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockingAxeViolations, formatAxe, settle } from './quality';

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
        if (curN > 0) await expect(picks.locator('li button[aria-expanded]').first()).toBeVisible();
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

    test('opening night: a coin flip is NO LEAN and the record matches the slate chip (fix4 F4-1)', async ({ page }) => {
        const history = JSON.parse(readFileSync(join(process.cwd(), 'data/prediction_history.json'), 'utf8')) as { date: string; homeWinProb: number; retro?: boolean }[];
        test.skip(!history.some(h => h.date === '2026-09-29' && !h.retro && Math.abs(h.homeWinProb - 50) < 1), 'needs the opening-night coin flip');
        await page.goto('/?date=2026-09-29');
        const chip = page.getByText(/^Picks\s*\d+-\d+$/i).first();
        await expect(chip).toBeVisible();
        const slate = ((await chip.textContent()) ?? '').match(/(\d+-\d+)/)![1];
        await page.goto('/accuracy');
        const card = reportCard(page);
        const picksRight = card.locator('div.panel').filter({ hasText: /^Picks right/i }).first();
        await expect(picksRight).toContainText(slate);
        if (curN === 3) {
            expect(slate).toBe('1-1');
            await expect(picksRight).toContainText('50.0%');
        }
        const picks = page.locator('section[aria-labelledby="every-pick"]');
        const noLean = picks.getByTestId('no-lean');
        await expect(noLean).toContainText(/No lean/i);
        await expect(noLean).toContainText(/NYR 0\s*@\s*BOS 3/);
        // NYR@BOS is not a ✓ row in the pick list.
        await expect(picks.locator('li button[aria-expanded]').filter({ hasText: /NYR 0/ })).toHaveCount(0);
    });

    test('GATE CLOSED, INFO ONLY, LEGACY and NO LEAN open their /methodology entries by tap or keyboard (fix4 F4-2)', async ({ page }, info) => {
        await page.goto('/accuracy');
        await settle(page);
        const targets: [RegExp, RegExp][] = [
            [/^Gate (closed|open)/i, /\/methodology#edge$/],
            [/^Info only/i, /\/methodology#term-disclaimer$/],
            [/^LEGACY/, /\/methodology#term-legacy$/],
            [/^No lean/i, /\/methodology#term-no-lean$/],
            [/^Log loss/i, /\/methodology#term-log-loss$/],
        ];
        for (const [name, url] of targets) {
            const link = page.getByRole('link', { name }).first();
            if (!(await link.count())) continue;
            const href = (await link.getAttribute('href')) ?? '';
            expect(href).toMatch(url);
            const box = (await link.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(24);
            if (info.project.name === 'mobile') await link.tap();
            else {
                await link.focus();
                await page.keyboard.press('Enter');
            }
            await expect(page).toHaveURL(url);
            await expect(page.locator(`[id="${href.split('#')[1]}"]`)).toBeInViewport();
            await page.goBack();
            await settle(page, 300);
        }
        // Visible copy stays terse: every link's visible text is 1-4 words.
        const visible = await page.locator('main a[data-gloss]').evaluateAll(els =>
            els.map(e => {
                const c = e.cloneNode(true) as HTMLElement;
                c.querySelectorAll('.sr-only').forEach(n => n.remove());
                return (c.textContent ?? '').trim();
            }),
        );
        for (const t of visible) expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(4);
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
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
