import { expect, test, type Page, type Route } from '@playwright/test';
import { blockingAxeViolations, formatAxe, horizontalOverflow, settle } from './quality';

/**
 * Home slate and matchup card (workstream E).
 * PLAYWRIGHT_BASE_URL=http://localhost:3221 npx playwright test tests/e2e/home.spec.ts
 *
 * Data-agnostic: every test reads the slate it is given (the live
 * predictions_detailed.csv) rather than assuming particular games.
 */

test.use({ timezoneId: 'America/New_York' });

interface CardInfo {
    id: string;
    anchor: string;
    date: string;
    start: string;
}

/** The slate the page ships, read from the first card's links and anchors. */
async function cards(page: Page): Promise<string[]> {
    return page.locator('article[id]').evaluateAll(els => els.map(e => e.id));
}

async function slateGames(page: Page): Promise<CardInfo[]> {
    // The share URL and anchor carry the date; puck drop is on each <time>.
    return page.locator('article[id]').evaluateAll(els =>
        els.map(e => ({
            id: '',
            anchor: e.id,
            date: new URL(window.location.href).searchParams.get('date') ?? '',
            start: e.querySelector('time')?.getAttribute('datetime') ?? '',
        })),
    );
}

function scoresFor(route: Route, games: { id: string; state: string; away: number; home: number; period: number; periodType: string; clock: string; last?: string }[]) {
    return route.fulfill({
        json: {
            date: 'x',
            fetchedAt: new Date().toISOString(),
            games: games.map(g => ({
                id: g.id,
                state: g.state,
                period: g.period,
                periodType: g.periodType,
                clock: g.clock,
                intermission: false,
                lastPeriodType: g.last ?? null,
                away: { score: g.away, sog: 20 },
                home: { score: g.home, sog: 15 },
            })),
        },
    });
}

/** NHL game ids of the displayed slate, from /api/matchup-details (same order as the CSV). */
async function gameIds(page: Page): Promise<Record<string, string>> {
    return page.evaluate(async () => {
        const res = await fetch('/api/matchup-details');
        const d = (await res.json()) as { games: Record<string, { home: { recent: unknown[] } }> };
        return Object.fromEntries(Object.keys(d.games).map(k => [k, k]));
    });
}

test.describe('home slate', () => {
    test('is static: HTML budget and no schedule fetch in the page', async ({ request }) => {
        const res = await request.get('/', { headers: { 'Accept-Encoding': 'identity' } });
        const html = await res.text();
        expect(html.length).toBeLessThanOrEqual(400 * 1024);
        expect(html).not.toContain('fullSchedule');
        expect(html).not.toContain('"history"');
    });

    test('has one h1, date tabs labelled Today/Tomorrow, and no tab bar', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toHaveCount(1);
        const tabs = page.getByRole('navigation', { name: 'Game day' }).getByRole('link');
        await expect(tabs.first()).toBeVisible();
        const labels = await tabs.allInnerTexts();
        expect(labels.join(' ')).toMatch(/Today|Tomorrow|\w{3}, \w{3} \d/);
        for (const gone of ['HISTORY', 'BRACKET', 'SKATERS']) await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
    });

    test('renders puck drop in the viewer zone with its abbreviation', async ({ page }) => {
        await page.goto('/');
        const time = page.locator('article time').first();
        const iso = await time.getAttribute('datetime');
        const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' }).format(new Date(iso!));
        await expect(time).toHaveText(expected);
        expect(expected).toMatch(/E[DS]T$/);
    });

    test('DOM stays small and collapsed cards hold no focusable content', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
        expect(nodes).toBeLessThanOrEqual(2500);
        const hiddenFocusables = await page.evaluate(() => {
            const sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
            return Array.from(document.querySelectorAll(sel)).filter(el => el.closest('[hidden]') || el.closest('[aria-expanded="false"] ~ *[hidden]')).length;
        });
        expect(hiddenFocusables).toBe(0);
        // Each toggle controls an existing, hidden (and empty) region.
        const toggles = page.locator('article h2 button[aria-expanded="false"]');
        const n = await toggles.count();
        for (let i = 0; i < n; i++) {
            const id = await toggles.nth(i).getAttribute('aria-controls');
            await expect(page.locator(`[id="${id}"]`)).toBeHidden();
            expect(await page.locator(`[id="${id}"] *`).count()).toBe(0);
        }
    });

    test('collapsed cards show both tricodes, Model % and Market %', async ({ page }) => {
        await page.goto('/');
        for (const card of await page.locator('article').all()) {
            const text = await card.innerText();
            const tris = text.match(/\b[A-Z]{3}\b/g) ?? [];
            expect(new Set(tris).size).toBeGreaterThanOrEqual(2);
            if (/Market/.test(text)) expect(text).toContain('Model');
            expect(text).not.toMatch(/\bGAS\b|\(L7\)|#16\b/);
        }
    });

    test('never shows units while the edge gate is closed', async ({ page }) => {
        await page.goto('/');
        const note = page.getByText("No bets: model hasn't beaten the market yet");
        if (await note.count()) {
            for (const card of await page.locator('article').all()) expect(await card.innerText()).not.toMatch(/\b\d+(\.\d)?u\b/);
        }
    });

    test('expanding cards loads player data once and never player_impact.json', async ({ page }) => {
        const urls: string[] = [];
        page.on('request', r => urls.push(r.url()));
        await page.goto('/');
        await settle(page);
        expect(urls.filter(u => u.includes('player_impact.json'))).toHaveLength(0);
        const toggles = page.locator('article h2 button[aria-expanded]');
        const n = await toggles.count();
        for (let i = 0; i < n; i++) await toggles.nth(i).click();
        await expect(page.getByRole('radio', { name: 'Lineups' }).first()).toBeVisible();
        await page.getByRole('radio', { name: 'Lineups' }).first().click();
        await settle(page);
        expect(urls.filter(u => u.includes('player_impact.json'))).toHaveLength(0);
        expect(urls.filter(u => u.includes('/api/matchup-details')).length).toBeLessThanOrEqual(1);
    });

    test('the why-this-pick waterfall fits a 390px phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.locator('article h2 button[aria-expanded]').first().click();
        await expect(page.getByRole('heading', { name: /^Why the .+ (is|are) favored$/ }).first()).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('tapping inside an expanded card keeps it open; Collapse closes it', async ({ page }) => {
        await page.goto('/');
        const card = page.locator('article').first();
        const toggle = card.locator('h2 button[aria-expanded]');
        await toggle.click();
        await card.getByRole('radio', { name: 'Lineups' }).click();
        const player = card.locator('[role="table"] [role="cell"] span.truncate').first();
        if (await player.count()) {
            await player.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        }
        await card.getByRole('button', { name: 'Collapse' }).click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('has no serious or critical axe violations, collapsed and expanded', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        let axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
        await page.locator('article h2 button[aria-expanded]').first().click();
        await settle(page);
        axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
    });
});

test.describe('game lifecycle', () => {
    test('a FINAL from the score feed shows FINAL/OT, the score and the model grade, no edge', async ({ page }) => {
        await page.goto('/');
        const [first] = await slateGames(page);
        const ids = Object.keys(await gameIds(page));
        // Pretend puck drop has passed so the page asks for scores.
        await page.clock.setFixedTime(new Date(new Date(first.start).getTime() + 3 * 3600_000));
        await page.route('**/api/scores?**', route =>
            scoresFor(route, ids.map(id => ({ id, state: 'OFF', away: 1, home: 0, period: 4, periodType: 'OT', clock: '00:00', last: 'OT' }))),
        );
        await page.reload();
        const card = page.locator(`article#${first.anchor}`);
        await expect(card).toContainText('FINAL/OT');
        await expect(card).toContainText('1-0');
        await expect(card).toContainText(/Model [✓✗]/);
        await expect(card).not.toContainText('Edge');
        expect(await card.innerText()).not.toMatch(/\b\d+(\.\d)?u\b/);
    });

    test('a LIVE game shows period and clock, pregame % dimmed, no edge', async ({ page }) => {
        await page.goto('/');
        const [first] = await slateGames(page);
        const ids = Object.keys(await gameIds(page));
        await page.clock.setFixedTime(new Date(new Date(first.start).getTime() + 3600_000));
        await page.route('**/api/scores?**', route =>
            scoresFor(route, ids.map(id => ({ id, state: 'LIVE', away: 2, home: 1, period: 2, periodType: 'REG', clock: '12:41' }))),
        );
        await page.reload();
        const card = page.locator(`article#${first.anchor}`);
        await expect(card).toContainText('P2 12:41');
        await expect(card).toContainText(/Pregame [A-Z]{3} \d+%/);
        await expect(card).not.toContainText('Edge');
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
    });

    test('polling stops once every game is final and the tab is hidden', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto('/');
        const [first] = await slateGames(page);
        const ids = Object.keys(await gameIds(page));
        await page.clock.setFixedTime(new Date(new Date(first.start).getTime() + 3 * 3600_000));
        let calls = 0;
        await page.route('**/api/scores?**', route => {
            calls++;
            return scoresFor(route, ids.map(id => ({ id, state: 'OFF', away: 3, home: 2, period: 3, periodType: 'REG', clock: '00:00', last: 'REG' })));
        });
        await page.reload();
        await expect(page.locator('article').first()).toContainText('FINAL');
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const before = calls;
        await page.waitForTimeout(61_000);
        expect(calls - before).toBe(0);
    });
});

test.describe('URL state and routes', () => {
    test('?date= opens that day and survives a reload', async ({ page }) => {
        await page.goto('/');
        const tabs = page.getByRole('navigation', { name: 'Game day' }).getByRole('link');
        const last = tabs.last();
        const href = await last.getAttribute('href');
        await last.click();
        await expect(page).toHaveURL(new RegExp(`\\${href!.replace('/', '')}`));
        await expect(last).toHaveAttribute('aria-current', 'date');
        await page.reload();
        await expect(page.getByRole('navigation', { name: 'Game day' }).getByRole('link').last()).toHaveAttribute('aria-current', 'date');
        await page.goto(href!);
        await expect(page.getByRole('navigation', { name: 'Game day' }).getByRole('link').last()).toHaveAttribute('aria-current', 'date');
    });

    test('an off day shows the next game day', async ({ page }) => {
        await page.goto('/?date=2030-01-01');
        await expect(page.getByText('No games on Jan 1')).toBeVisible();
    });

    test('legacy ?tab= links redirect to the new routes', async ({ request }) => {
        for (const [tab, dest] of [['Teams', '/teams'], ['History', '/accuracy'], ['Skaters', '/players'], ['Bracket', '/standings'], ['News', '/news']]) {
            const res = await request.get(`/?tab=${tab}`, { maxRedirects: 0 });
            expect(res.status(), tab).toBeGreaterThanOrEqual(300);
            expect(res.status(), tab).toBeLessThan(400);
            expect(new URL(res.headers().location, 'http://x').pathname).toBe(dest);
        }
    });

    test('Back from a team page entered via /teams returns to /teams', async ({ page }) => {
        await page.goto('/teams');
        await page.locator('a[href="/teams/EDM"]').first().click();
        await expect(page).toHaveURL(/\/teams\/EDM/);
        await page.goBack();
        await expect(page).toHaveURL(/\/teams$/);
    });

    test('a card anchor scrolls to and highlights the card', async ({ page }) => {
        await page.goto('/');
        const tabs = page.getByRole('navigation', { name: 'Game day' }).getByRole('link');
        await tabs.last().click();
        const [anchor] = await cards(page);
        await page.goto(`/#${anchor}`);
        const card = page.locator(`article#${anchor}`);
        await expect(card).toBeInViewport();
        await expect(card).toHaveClass(/border-brand/);
    });
});

test.describe('favourites', () => {
    test("following a team pins its game first after reload", async ({ page }) => {
        await page.goto('/');
        const ids = await cards(page);
        const lastCard = page.locator(`article#${ids[ids.length - 1]}`);
        const star = lastCard.getByRole('button', { name: /^Follow the / }).last();
        await star.click();
        await page.reload();
        await expect(page.locator('article').first()).toHaveAttribute('id', ids[ids.length - 1]);
        await expect(page.getByRole('heading', { name: /Your team/ })).toBeVisible();
    });

    test('renders normally when localStorage throws', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                configurable: true,
                get() {
                    throw new Error('blocked');
                },
            });
        });
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto('/');
        await expect(page.locator('article').first()).toBeVisible();
        await page.locator('article').first().getByRole('button', { name: /^Follow the / }).first().click();
        expect(errors).toEqual([]);
    });
});

test.describe('odds-history API', () => {
    test('rejects path traversal with 400', async ({ request }) => {
        const res = await request.get('/api/odds-history?gameId=1&date=../../pipeline/nhl_historical_shots');
        expect(res.status()).toBe(400);
    });
});
