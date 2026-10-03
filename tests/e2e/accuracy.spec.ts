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
        // The season record equals the opening-night chip only until a second slate is graded.
        const openingN = history.filter(h => h.date === '2026-09-29' && !h.retro).length;
        if (curN === openingN) await expect(picksRight).toContainText(slate);
        if (curN === 3) {
            expect(slate).toBe('1-1');
            await expect(picksRight).toContainText('50.0%');
        }
        const picks = page.locator('section[aria-labelledby="every-pick"]');
        const noLean = picks.getByTestId('no-lean').filter({ hasText: /NYR 0\s*@\s*BOS 3/ });
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
        // Audit from the top: goBack restores a scroll offset that can park the game-list
        // select under the sticky app bar, which axe's target-size rule counts as obscured
        // (focus itself clears the bar via scroll-padding-top).
        await page.evaluate(() => window.scrollTo(0, 0));
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
    });

    test('picks group by day: newest open, the rest expand by click or keyboard', async ({ page }) => {
        await page.goto('/accuracy?season=2025-26');
        const picks = page.locator('section[aria-labelledby="every-pick"]');
        const days = picks.locator('[data-day]');
        await expect(days.first()).toBeVisible();
        expect(await days.count()).toBeGreaterThan(2);
        const dates = await days.evaluateAll(els => els.map(e => e.getAttribute('data-day') ?? ''));
        expect(dates).toEqual([...dates].sort().reverse());

        const head = (i: number) => days.nth(i).locator(':scope > button');
        const rowsOf = (i: number) => days.nth(i).locator(':scope > ul > li');
        await expect(head(0)).toHaveAttribute('aria-expanded', 'true');
        expect(await rowsOf(0).count()).toBeGreaterThan(0);
        // Collapsed days keep their game rows out of the DOM.
        await expect(head(1)).toHaveAttribute('aria-expanded', 'false');
        await expect(rowsOf(1)).toHaveCount(0);
        const controls = await head(1).getAttribute('aria-controls');
        await expect(page.locator(`[id="${controls}"]`)).toBeHidden();

        // Click opens the day: one row per pick, and its record matches the ✓/✕ badges.
        await head(1).click();
        await expect(head(1)).toHaveAttribute('aria-expanded', 'true');
        const text = (await head(1).textContent()) ?? '';
        const n = Number(text.match(/(\d+) games?/i)![1]);
        await expect(rowsOf(1)).toHaveCount(n);
        const [hits, misses] = text.match(/(\d+)-(\d+)/)!.slice(1).map(Number);
        expect(hits + misses).toBe(n);
        await expect(rowsOf(1).locator('button > span:first-child').filter({ hasText: '✓' })).toHaveCount(hits);

        // Keyboard: Enter opens, Space closes.
        await head(2).focus();
        await page.keyboard.press('Enter');
        await expect(head(2)).toHaveAttribute('aria-expanded', 'true');
        await expect(rowsOf(2).first()).toBeVisible();
        await page.keyboard.press('Space');
        await expect(head(2)).toHaveAttribute('aria-expanded', 'false');
        await expect(rowsOf(2)).toHaveCount(0);

        // Expand all / collapse all.
        await picks.getByRole('button', { name: /expand all days/i }).click();
        const count = await days.count();
        await expect(picks.locator('[data-day] > button[aria-expanded="true"]')).toHaveCount(count);
        await picks.getByRole('button', { name: /collapse all days/i }).click();
        await expect(picks.locator('[data-day] > button[aria-expanded="true"]')).toHaveCount(0);
    });

    test('filters reshape the day summaries', async ({ page }) => {
        await page.goto('/accuracy?season=2025-26');
        const picks = page.locator('section[aria-labelledby="every-pick"]');
        const days = picks.locator('[data-day]');
        await expect(days.first()).toBeVisible();
        // Unfiltered, some day has more than one game.
        expect((await days.locator(':scope > button').allTextContents()).some(t => /\b([2-9]|\d\d) games\b/.test(t))).toBe(true);

        // Team: every listed game involves the team, and the newest open day is that team's.
        await picks.getByLabel('Team').selectOption('EDM');
        await expect(days.locator(':scope > button').filter({ hasText: /\b([2-9]|\d\d) games\b/ })).toHaveCount(0);
        await expect(days.first().locator(':scope > button')).toHaveAttribute('aria-expanded', 'true');
        const rows = days.first().locator(':scope > ul > li');
        for (const t of await rows.allTextContents()) expect(t).toContain('EDM');
        for (const t of await days.locator(':scope > button').allTextContents()) expect(t).toMatch(/\b1 game\b/i);

        // ✓ only: every day is a perfect record; ✕ only: every day is 0-N.
        await picks.getByRole('radio', { name: 'Right' }).click();
        for (const t of await days.locator(':scope > button').allTextContents()) expect(t).toMatch(/\d+-0,\s*100%/);
        await picks.getByRole('radio', { name: 'Wrong' }).click();
        for (const t of await days.locator(':scope > button').allTextContents()) expect(t).toMatch(/0-\d+,\s*0%/);
    });

    test('375px: day summaries fit with no horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/accuracy?season=2025-26');
        const days = page.locator('section[aria-labelledby="every-pick"] [data-day]');
        await expect(days.first()).toBeVisible();
        await days.nth(1).locator(':scope > button').click();
        await settle(page, 300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        // The condensed row still carries date, record, hit rate and the market delta.
        const head = days.first().locator(':scope > button');
        await expect(head).toContainText(/\w{3} · \w{3} \d+/);
        await expect(head).toContainText(/\d+-\d+/);
        await expect(head).toContainText(/\d+%/);
        await expect(head).toContainText(/vs mkt/i);
        const box = (await head.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(375);
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
