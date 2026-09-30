import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Design system + app shell checks (workstream D).
 * Runs against a started server: BASE_URL / playwright baseURL.
 * axe-core is injected from node_modules (it ships with eslint-plugin-jsx-a11y).
 */

const AXE_SRC = readFileSync(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8');

async function axeSerious(page: Page, include?: string) {
    await page.addScriptTag({ content: AXE_SRC });
    return page.evaluate(async sel => {
        // @ts-expect-error injected global
        const r = await window.axe.run(sel ? { include: [sel] } : document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
        return r.violations
            .filter((v: { impact: string }) => v.impact === 'serious' || v.impact === 'critical')
            .map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
    }, include ?? null);
}

test.describe('primitives (/ui-kit)', () => {
    test('axe: 0 serious/critical on the primitives page', async ({ page }) => {
        await page.goto('/ui-kit');
        expect(await axeSerious(page, 'main')).toEqual([]);
    });

    test('hydrates without errors and names every props region uniquely (fix4 F4-9)', async ({ page, request }) => {
        const problems: string[] = [];
        page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
        page.on('console', m => {
            if (m.type() === 'error') problems.push(m.text());
        });
        // The server HTML carries no clock-dependent badge text, so it can never differ from the client's first render.
        const html = await (await request.get('/ui-kit')).text();
        expect(html).not.toMatch(/title="Updated \d/);
        await page.goto('/ui-kit');
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await expect(page.locator('#kit-dialog')).toContainText(/Updated 4m/i);
        expect(problems).toEqual([]);
        const labels = await page.locator('[role="region"][aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
        expect(labels).toContain('WinBar props');
        expect(new Set(labels).size).toBe(labels.length);
    });

    test('StatChip prior always shows its season tag', async ({ page }) => {
        await page.goto('/ui-kit');
        const prior = page.locator('#kit-chips [data-state="prior"]');
        await expect(prior).toHaveCount(2);
        for (const chip of await prior.all()) await expect(chip).toContainText(/\d{2}-\d{2}/);
    });

    test('InfoTip opens on keyboard Enter and closes on Esc', async ({ page }) => {
        await page.goto('/ui-kit');
        const trigger = page.getByRole('button', { name: 'What is Our forecast (published win probability)?' });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const tip = page.getByRole('dialog', { name: 'Our forecast (published win probability)' });
        await expect(tip).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(tip).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test('InfoTip is portalled; Tab steps into its link, then past the trigger', async ({ page }) => {
        await page.goto('/ui-kit');
        const trigger = page.getByRole('button', { name: 'What is Our forecast (published win probability)?' });
        await trigger.focus();
        const tip = page.getByRole('dialog', { name: 'Our forecast (published win probability)' });
        await expect(tip).toBeVisible();
        // Rendered outside any card, so an overflow/transform ancestor can't clip it.
        expect(await tip.evaluate(el => el.closest('main') === null)).toBe(true);
        await page.keyboard.press('Tab');
        await expect(tip.getByRole('link', { name: /How we calculate it/ })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(tip).toBeHidden();
        await expect(page.getByRole('button', { name: 'What is Market probability (de-vigged)?' })).toBeFocused();
    });

    test('Dialog traps focus, is labelled, and closes on Esc', async ({ page }) => {
        await page.goto('/ui-kit');
        const open = page.getByRole('button', { name: 'Open dialog' });
        await open.click();
        const dialog = page.getByRole('dialog', { name: 'Odds movement' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
        for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
        expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(open).toBeFocused();
    });

    test('SortHeader exposes aria-sort and sorts by keyboard', async ({ page }) => {
        await page.goto('/ui-kit');
        const xgf = page.locator('th', { has: page.getByRole('button', { name: 'xGF%' }) });
        await expect(xgf).toHaveAttribute('aria-sort', 'none');
        await page.getByRole('button', { name: 'xGF%' }).focus();
        await page.keyboard.press('Enter');
        await expect(xgf).toHaveAttribute('aria-sort', 'descending');
    });
});

test.describe('InfoTip on touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    test('opens on tap', async ({ page }) => {
        await page.goto('/ui-kit');
        await page.getByRole('button', { name: 'What is Market probability (de-vigged)?' }).tap();
        await expect(page.getByRole('dialog', { name: 'Market probability (de-vigged)' })).toBeVisible();
    });
});

test.describe('app shell', () => {
    test('first Tab stop is "Skip to content"; logo link is named', async ({ page }) => {
        await page.goto('/methodology');
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toHaveText('Skip to content');
        await expect(page.getByRole('link', { name: 'Pony xG home' })).toBeVisible();
    });

    test('/teams/EDM shows the site nav with Teams active', async ({ page }) => {
        await page.goto('/teams/EDM');
        const nav = page.getByRole('navigation', { name: 'Main' });
        await expect(nav.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    });

    test('only the home page gets the dated slate title', async ({ page }) => {
        await page.goto('/teams/EDM');
        await expect(page).toHaveTitle(/Edmonton Oilers/);
        await page.goto('/methodology');
        await expect(page).toHaveTitle('How it works | Pony xG');
        await page.goto('/teams');
        await expect(page).not.toHaveTitle(/Pony xG \| Pony xG/);
    });

    test('/nonexistent is a 404 with the nav visible', async ({ page }) => {
        const res = await page.goto('/nonexistent-page');
        expect(res?.status()).toBe(404);
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
        await expect(page.getByRole('link', { name: "Go to today's games" })).toBeVisible();
    });

    test('/opengraph-image is a 1200x630 PNG', async ({ request }) => {
        const res = await request.get('/opengraph-image');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('image/png');
        const buf = await res.body();
        expect(buf.readUInt32BE(16)).toBe(1200);
        expect(buf.readUInt32BE(20)).toBe(630);
    });

    test('theme-color, manifest and a dated home title', async ({ page, request }) => {
        await page.goto('/');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#05070B');
        const month = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short' });
        await expect(page).toHaveTitle(new RegExp(month));
        const manifest = await (await request.get('/manifest.webmanifest')).json();
        expect(manifest.display).toBe('standalone');
        expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    });

    test('no runtime fetch of /ponyxG_full.svg and no hidden SSR wrapper', async ({ page, request }) => {
        const html = await (await request.get('/methodology')).text();
        expect(html).not.toMatch(/<div[^>]*style="opacity:0/);
        const urls: string[] = [];
        page.on('request', r => urls.push(r.url()));
        await page.goto('/methodology');
        await page.waitForTimeout(500);
        expect(urls.filter(u => u.includes('ponyxG_full.svg'))).toEqual([]);
    });

    test('methodology has an h1 and passes axe', async ({ page }) => {
        await page.goto('/methodology');
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        expect(await axeSerious(page)).toEqual([]);
    });
});

test.describe('reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });
    for (const route of ['/', '/methodology']) {
        test(`no running animations after 1s on ${route}`, async ({ page }) => {
            await page.goto(route);
            await page.waitForTimeout(1000);
            const running = await page.evaluate(() =>
                document
                    .getAnimations()
                    .filter(a => a.playState === 'running')
                    .map(a => `${(a as CSSAnimation).animationName ?? 'anim'} on ${(a.effect as KeyframeEffect | null)?.target?.tagName ?? '?'}`),
            );
            expect(running).toEqual([]);
        });
    }
});

test.describe('mobile shell (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    test('primary destinations reachable, targets ≥44px, no horizontal scroll', async ({ page }) => {
        await page.goto('/methodology');
        const tabbar = page.getByRole('navigation', { name: 'Main' });
        for (const name of ['Tonight', 'Teams', 'Players', 'Accuracy']) {
            const link = tabbar.getByRole('link', { name });
            await expect(link).toBeVisible();
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await tabbar.getByRole('button', { name: /More sections/ }).tap();
        const sheet = page.getByRole('dialog', { name: 'More' });
        for (const name of ['Standings', 'News']) {
            const link = sheet.getByRole('link', { name: new RegExp(name) });
            await expect(link).toBeVisible();
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});
