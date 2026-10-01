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

    test('has one h1 (the date), mono day chips with game counts, one legend, and no tab bar', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1')).toContainText(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) · \w{3} \d/i);
        const tabs = page.getByRole('navigation', { name: 'Game day' }).getByRole('link');
        await expect(tabs.first()).toBeVisible();
        const labels = await tabs.allInnerTexts();
        for (const l of labels) expect(l).toMatch(/^(TONIGHT|YESTERDAY|MON|TUE|WED|THU|FRI|SAT|SUN|[A-Z]{3} \d{1,2})\s+\d+$/);
        await expect(page.getByText('Market', { exact: true })).toHaveCount(1);
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

    test('collapsed cards: both tricodes, win bar with market tick, labels and numbers only', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        for (const card of await page.locator('article').all()) {
            const text = await card.innerText();
            const tris = text.match(/\b[A-Z]{3}\b/g) ?? [];
            expect(new Set(tris).size).toBeGreaterThanOrEqual(2);
            const bar = card.locator('[role="img"][aria-label*="win probability"]');
            if (await bar.count()) {
                const label = (await bar.getAttribute('aria-label')) ?? '';
                if (/[+−-]\d{3}/.test(text)) expect(label).toMatch(/Market: [A-Z]{3} \d+%/);
            }
            // No sentences and no info icons on a collapsed card.
            const visibleText = await card.evaluate(el => {
                const c = el.cloneNode(true) as HTMLElement;
                c.querySelectorAll('.sr-only').forEach(n => n.remove());
                return (c.textContent ?? '').replace(/\s+/g, ' ');
            });
            expect(visibleText).not.toMatch(/[A-Za-z]{3,}(\s+[A-Za-z]{2,}){4,}/);
            expect(await card.getByRole('button', { name: /^What (is|does)/ }).count()).toBe(0);
            expect(text).not.toMatch(/\bGAS\b|\(L7\)|#16\b|Our forecast|Model only/);
        }
    });

    test('goalie stat lines from last season carry a 25-26 tag', async ({ page }) => {
        await page.goto('/');
        // The h2 is the matchup name only, so the goalie lines sit beside it, not inside it.
        const lines = await page.locator('article [class*="gstat"] > span:first-child:has(.sr-only)').all();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            const sr = (await line.locator('.sr-only').textContent()) ?? '';
            if (/25-26 season/.test(sr)) await expect(line).toContainText('25-26');
            else expect(sr).toMatch(/^This season/);
        }
    });

    test('never shows units while the edge gate is closed', async ({ page }) => {
        await page.goto('/');
        for (const card of await page.locator('article').all()) {
            const text = await card.innerText();
            if (!/EDGE/i.test(text)) expect(text).not.toMatch(/\b\d+(\.\d)?u\b/);
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
        await expect(page.getByRole('radio', { name: 'Lines' }).first()).toBeVisible();
        await page.getByRole('radio', { name: 'Lines' }).first().click();
        await settle(page);
        expect(urls.filter(u => u.includes('player_impact.json'))).toHaveLength(0);
        expect(urls.filter(u => u.includes('/api/matchup-details')).length).toBeLessThanOrEqual(1);
    });

    test('the why-this-pick waterfall fits a 390px phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        const card = page.locator('article').first();
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Why' }).click();
        await expect(card.getByRole('heading', { name: /^Why: / })).toHaveCount(1);
        await expect(card.locator('[class*="whyFill"]').first()).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('the why panel shows the lineup / starting-goalie bar when the model has it', async ({ page }) => {
        await page.goto('/');
        const card = page.locator('article').first();
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Why' }).click();
        const rows = card.locator('section[aria-labelledby^="why-"] li');
        await expect(rows.first()).toBeVisible();
        const labels = await rows.allInnerTexts();
        // Fast-track models publish a 'lineup_goalie' factor; older frozen rows keep 'lineup'.
        const who = labels.find(t => /who plays/i.test(t));
        const old = labels.find(t => /^lineups/i.test(t.trim()));
        expect(who ?? old).toBeTruthy();
        if (who) expect(who).toMatch(/(\+\d+\.\d [A-Z]{3}|0\.0)/);
    });

    test('tapping inside an expanded card keeps it open; Collapse closes it', async ({ page }) => {
        await page.goto('/');
        const card = page.locator('article').first();
        const toggle = card.locator('h2 button[aria-expanded]');
        await toggle.click();
        await card.getByRole('radio', { name: 'Lines' }).click();
        const player = card.locator('[role="table"] [role="cell"] span.truncate').first();
        if (await player.count()) {
            await player.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        }
        await card.getByRole('button', { name: 'Collapse' }).click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('Collapse hands keyboard focus back to the card toggle, without smooth scroll under reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await settle(page);
        const behaviours: string[] = [];
        await page.exposeFunction('__scrollBehaviour', (b: string) => behaviours.push(b));
        await page.evaluate(() => {
            const orig = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
                (window as unknown as { __scrollBehaviour: (b: string) => void }).__scrollBehaviour(typeof arg === 'object' ? String(arg.behavior ?? 'auto') : 'auto');
                return orig.call(this, arg);
            };
        });
        const cardsOnPage = page.locator('article[id]');
        const n = Math.min(await cardsOnPage.count(), 3);
        const names = new Set<string>();
        for (let i = 0; i < n; i++) {
            const card = cardsOnPage.nth(i);
            const toggle = card.locator('h2 button[aria-expanded]');
            await toggle.focus();
            await page.keyboard.press('Enter');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            const collapse = card.getByRole('button', { name: /^Collapse / });
            const name = (await collapse.getAttribute('aria-label')) ?? '';
            expect(name).not.toContain('@');
            names.add(name);
            await collapse.focus();
            await page.keyboard.press('Enter');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(await toggle.evaluate(el => el === document.activeElement)).toBe(true);
        }
        expect(names.size).toBe(n);
        expect(behaviours.length).toBeGreaterThan(0);
        expect(behaviours).not.toContain('smooth');
    });

    test('the legend opens Reading a card, and a Why-tab chip opens its glossary entry', async ({ page }) => {
        await page.goto('/');
        const legend = page.locator('a[href="/methodology#reading"]').first();
        if (await legend.count()) {
            await legend.click();
            await expect(page).toHaveURL(/\/methodology#reading$/);
            await expect(page.locator('#reading')).toBeInViewport();
            await page.goBack();
        }
        const card = page.locator('article[id]').first();
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Why' }).click();
        // Anchors G3 is still adding (term-opener, term-wt, term-lean) are skipped here.
        const chip = card.locator('[role="region"] a[href^="/methodology#term-"]:not([href$="-opener"]):not([href$="-wt"]):not([href$="-lean"])').first();
        await expect(chip).toBeVisible();
        const href = (await chip.getAttribute('href')) ?? '';
        await chip.click();
        await expect(page).toHaveURL(new RegExp(`${href.replace(/[#/]/g, '\\$&')}$`));
        await expect(page.locator(`[id="${href.split('#')[1]}"]`)).toBeInViewport();
    });

    test('Odds tab: the line-move dialog shows moneyline and total movement with zoned times (mocked API)', async ({ page }) => {
        const entries = [
            { timestamp: '2026-09-30T12:42:49Z', awayOdds: '+110', homeOdds: '-130', awayDir: null, homeDir: null, isOpen: true, isLatest: false, total: { line: '6', over: '-117', under: '-103' }, totalDir: null },
            { timestamp: '2026-09-30T14:39:17Z', awayOdds: '+112', homeOdds: '-133', awayDir: 'up', homeDir: 'down', isOpen: false, isLatest: false, total: { line: '6', over: '-110', under: '-110' }, totalDir: null },
            { timestamp: '2026-09-30T19:05:00Z', awayOdds: '+120', homeOdds: '-142', awayDir: 'up', homeDir: 'down', isOpen: false, isLatest: true, total: { line: '5.5', over: '-130', under: '+110' }, totalDir: 'down' },
        ];
        let hits = 0;
        await page.route('**/api/odds-history?**', route => {
            hits++;
            return route.fulfill({ json: { entries } });
        });
        await page.goto('/');
        await settle(page);
        const card = page.locator('article').filter({ has: page.locator('[role="img"][aria-label*="Market:"]') }).first();
        test.skip((await card.count()) === 0, 'no game with a market on this slate');
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Odds' }).click();
        const trigger = card.getByRole('button', { name: /Line move/ });
        await expect(trigger).toBeVisible();
        expect(hits).toBeGreaterThan(0);
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Line move' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('moneyline and total');
        await expect(dialog).toContainText('6 → 5.5');
        await expect(dialog.getByRole('columnheader', { name: 'Total' })).toBeVisible();
        const rows = dialog.locator('tbody tr');
        await expect(rows).toHaveCount(3);
        // First seen / Latest labels, and every time carries a zone (the test runs in America/New_York).
        await expect(rows.first()).toContainText('First');
        await expect(rows.last()).toContainText(/Latest|Close/);
        for (const r of await rows.all()) await expect(r.locator('th')).toContainText(/\d{1,2}:\d{2} [AP]M E[DS]T/);
        await expect(rows.last()).toContainText('5.5');
        await expect(rows.last()).toContainText(/O\s*[−-]130/);
        await expect(rows.last()).toContainText('down');
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test('lean flag, B2B chip, FAIR and NO BET open the glossary; tapping them never toggles the card (fix4 F4-3)', async ({ page }, info) => {
        const tap = async (l: ReturnType<Page['locator']>) => (info.project.name === 'mobile' ? l.tap() : l.click());
        for (const date of ['', '2026-10-01']) {
            await page.goto(date ? `/?date=${date}` : '/');
            await settle(page, 300);
            for (const [sel, href] of [
                ['a[data-lean]', '/methodology#term-lean'],
                ['a[data-chip="b2b"]', '/methodology#term-b2b'],
            ] as const) {
                const link = page.locator(`article ${sel}`).first();
                if (!(await link.count())) continue;
                await expect(link).toHaveAttribute('href', href);
                expect(await link.evaluate(a => !!a.closest('button') || a.getAttribute('aria-hidden') === 'true')).toBe(false);
                const box = (await link.boundingBox())!;
                expect(box.height).toBeGreaterThanOrEqual(24);
                // First with navigation blocked: the tap reaches the link, not the card toggle under it.
                const card = link.locator('xpath=ancestor::article');
                const toggle = card.locator('h2 button[aria-expanded]');
                await link.evaluate(a => a.addEventListener('click', e => e.preventDefault(), { once: true }));
                await tap(link);
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await tap(link);
                await expect(page).toHaveURL(new RegExp(`${href.replace(/[#/]/g, '\\$&')}$`));
                await expect(page.locator(`[id="${href.split('#')[1]}"]`)).toBeInViewport();
                await page.goBack();
                await settle(page, 300);
            }
            // Tapping the bar still expands the card.
            const first = page.locator('article[id]').first();
            const bar = (await first.locator('[role="img"][aria-label*="win probability"]').first().boundingBox())!;
            if (info.project.name === 'mobile') await page.touchscreen.tap(bar.x + bar.width / 2, bar.y + bar.height / 2);
            else await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
            await expect(first.locator('h2 button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
        }
        // Odds tab: FAIR → fair odds, NO BET → the edge section.
        const card = page.locator('article').filter({ has: page.locator('[role="img"][aria-label*="Market:"]') }).first();
        test.skip((await card.count()) === 0, 'no priced game');
        const toggle = card.locator('h2 button[aria-expanded]');
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        await card.getByRole('radio', { name: 'Odds' }).click();
        const fair = card.getByRole('link', { name: /^Fair/ });
        await expect(fair).toHaveAttribute('href', '/methodology#term-fair-odds');
        const noBet = card.getByRole('link', { name: /^No bet/i });
        if (await noBet.count()) await expect(noBet).toHaveAttribute('href', '/methodology#edge');
        await tap(fair);
        await expect(page).toHaveURL(/\/methodology#term-fair-odds$/);
        await expect(page.locator('#term-fair-odds')).toBeInViewport();
    });

    test('expanded cards never scroll sideways: 10 expand/collapse cycles on every tab (fix4 F4-5)', async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', '1440px check');
        test.setTimeout(180_000);
        await page.goto('/');
        await settle(page, 300);
        const arts = page.locator('article[id]');
        const n = await arts.count();
        for (let i = 0; i < n; i++) {
            const art = arts.nth(i);
            const toggle = art.locator('h2 button[aria-expanded]');
            for (let k = 0; k < 10; k++) {
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                for (const tab of ['Goalies', 'Lines', 'Odds', 'Why']) {
                    const radio = art.getByRole('radio', { name: tab });
                    if (!(await radio.count())) continue;
                    await radio.click();
                    await page.waitForTimeout(40);
                    const m = await art.evaluate(el => ({ left: el.scrollLeft, sw: el.scrollWidth, cw: el.clientWidth }));
                    expect(m.left, `${i} ${tab} #${k}`).toBe(0);
                    expect(m.sw, `${i} ${tab} #${k}`).toBeLessThanOrEqual(m.cw + 1);
                }
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                expect(await art.evaluate(el => el.scrollLeft)).toBe(0);
            }
        }
    });

    test('goalie names keep their surname next to IR chips (fix4 F4-6)', async ({ page }) => {
        await page.goto('/?date=2026-10-01');
        await settle(page, 300);
        const games = page.locator('article[id]').filter({ hasText: /EDM|FLA/ });
        const n = await games.count();
        test.skip(n === 0, 'EDM / FLA not on 2026-10-01');
        for (let i = 0; i < n; i++) {
            const art = games.nth(i);
            await art.locator('h2 button[aria-expanded]').click();
            await art.getByRole('radio', { name: 'Goalies' }).click();
            await page.waitForTimeout(400);
            const names = await art.locator('[data-goalie-name]').evaluateAll(els =>
                els.map(e => ({ text: (e.textContent ?? '').trim(), w: e.getBoundingClientRect().width, full: e.scrollWidth <= e.clientWidth + 1 })),
            );
            expect(names.length).toBeGreaterThan(0);
            for (const nm of names) {
                expect(nm.w, nm.text).toBeGreaterThanOrEqual(40);
                // Either the whole surname fits, or at least 7 characters show before the ellipsis.
                if (!nm.full) expect(nm.w, nm.text).toBeGreaterThanOrEqual(56);
            }
        }
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
        await expect(card).toContainText(/FINAL · OT/i);
        await expect(card).toContainText('1-0');
        await expect(card).toContainText(/Model pick (right|wrong)/);
        await expect(card.locator('[role="img"][aria-label^="Pregame win probability"]')).toHaveAttribute('data-dimmed', 'true');
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
        await expect(card.locator('.live-dot')).toHaveCount(1);
        await expect(card.locator('[role="img"][aria-label^="Pregame win probability"]')).toHaveCount(1);
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
        await expect(page.getByText('No games', { exact: true })).toBeVisible();
        // The date lives in the heading only (no repeated date line in the empty state).
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/Jan 1/i);
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
        await page.waitForLoadState('networkidle');
        const [anchor] = await cards(page);
        // Load the anchor on the same slate the card came from (not today's).
        await page.goto(`${page.url().split('#')[0]}#${anchor}`);
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

    test('a long YOUR TEAMS strip scrolls inside itself at 390px, spells out Playoffs, no page overflow', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        const tris = await page.locator('article [data-tri]').allTextContents();
        await page.evaluate(t => localStorage.setItem('ponyxg:favorites', JSON.stringify(t)), [...new Set(tris)]);
        await page.reload();
        const strip = page.locator('section[aria-labelledby="your-team"]');
        await expect(strip).toBeVisible();
        expect(await strip.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(390);
        expect(await strip.innerText()).not.toMatch(/\bPO\b/);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
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
