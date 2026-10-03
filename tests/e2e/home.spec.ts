import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** The last slate in the predictions file: every game on it is still pregame, whatever the clock says. */
function pregameSlate(): string {
    const [head, ...lines] = readFileSync(join(process.cwd(), 'public/data/predictions_detailed.csv'), 'utf8').trim().split('\n');
    const col = head.split(',').indexOf('game_date');
    const dates = lines.map(l => l.split(',')[col]).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return `/?date=${dates[dates.length - 1]}`;
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
        await page.goto(pregameSlate());
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
        // A fixed shell (~260 nodes) plus ~105 per collapsed card (13 games: ~1,600). The desktop
        // rail + pane is client-only and mounts at xl only, so it never counts here.
        const games = await page.locator('article[id]').count();
        expect(nodes).toBeLessThanOrEqual(Math.max(2500, 600 + 120 * games));
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
        for (const card of await page.locator('article[id]').all()) {
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
        await page.goto(pregameSlate());
        await settle(page);
        // Read every line in one pass: the slate re-renders while games are live, so
        // per-element locators taken from .all() can go stale mid-loop.
        const lines = await page.locator('article [class*="gstat"] > span:first-child:has(.sr-only)').evaluateAll(els =>
            els.map(e => {
                const sr = e.querySelector('.sr-only')?.textContent ?? '';
                const c = e.cloneNode(true) as HTMLElement;
                c.querySelectorAll('.sr-only').forEach(n => n.remove());
                return { sr, visible: c.textContent ?? '' };
            }),
        );
        // The h2 is the matchup name only, so the goalie lines sit beside it, not inside it.
        const season = lines.filter(l => !/^Career versus/.test(l.sr));
        expect(season.length).toBeGreaterThan(0);
        for (const { sr, visible } of season) {
            if (/25-26 season/.test(sr)) expect(visible).toContain('25-26');
            else expect(sr).toMatch(/^This season/);
        }
    });

    test('shows units only beside a +EV bet', async ({ page }) => {
        await page.goto('/');
        for (const card of await page.locator('article[id]').all()) {
            const text = await card.innerText();
            if (!/\+EV/i.test(text)) expect(text).not.toMatch(/\b\d+(\.\d)?u\b/);
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
        await page.goto(pregameSlate());
        const card = page.locator('article[id]').first();
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Why' }).click();
        await expect(card.getByRole('heading', { name: /^Why: / })).toHaveCount(1);
        await expect(card.locator('[class*="whyFill"]').first()).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('the why panel shows the lineup / starting-goalie bar when the model has it', async ({ page }) => {
        await page.goto(pregameSlate());
        const card = page.locator('article[id]').first();
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Why' }).click();
        const rows = card.locator('section[aria-labelledby^="why-"] li');
        await expect(rows.first()).toBeVisible();
        const labels = await rows.allInnerTexts();
        // The simulator folds the lineup into its 5v5 row ("5v5"); logit rows publish
        // 'lineup_goalie' ('who plays'), and older frozen rows keep 'lineup'.
        const sim = labels.find(t => /^5v5\b/i.test(t.trim()));
        const who = labels.find(t => /who plays/i.test(t));
        const old = labels.find(t => /^lineups/i.test(t.trim()));
        expect(sim ?? who ?? old).toBeTruthy();
        if (who) expect(who).toMatch(/(\+\d+\.\d [A-Z]{3}|0\.0)/);
    });

    test.describe('in a zone the server is not in', () => {
        // Zone-dependent text in server HTML (a puck drop in the server's zone) is a hydration
        // mismatch: React throws away the server DOM and re-renders, and a tap in that window is lost.
        test.use({ timezoneId: 'Pacific/Honolulu' });
        test('hydrates without errors at phone, laptop and rail + pane widths', async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', e => errors.push(e.message));
            for (const width of [390, 1200, 1600]) {
                await page.setViewportSize({ width, height: 900 });
                for (const url of ['/', pregameSlate()]) {
                    await page.goto(url);
                    await settle(page, 250);
                }
            }
            expect(errors).toEqual([]);
        });
    });

    test('tapping inside an expanded card keeps it open; Collapse closes it', async ({ page }) => {
        await page.goto(pregameSlate());
        const card = page.locator('article[id]').first();
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
        const card = page.locator('article[id]').filter({ has: page.locator('[role="img"][aria-label*="Market:"]') }).first();
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

    test('lean flag, B2B chip, FORECAST and NO BET open the glossary; tapping them never toggles the card (fix4 F4-3)', async ({ page }, info) => {
        const tap = async (l: ReturnType<Page['locator']>) => (info.project.name === 'mobile' ? l.tap() : l.click());
        for (const date of ['', '2026-10-01']) {
            await page.goto(date ? `/?date=${date}` : '/');
            await settle(page, 300);
            for (const [sel, href] of [
                ['a[data-lean]', '/methodology#term-lean'],
                ['a[data-chip="b2b"]', '/methodology#term-b2b'],
            ] as const) {
                // Final cards don't expand, so only pregame/live cards carry the toggle under the link.
                const link = page.locator(`article:has(h2 button[aria-expanded]) ${sel}`).first();
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
            const first = page.locator('article[id]').filter({ has: page.locator('h2 button[aria-expanded]') }).first();
            if (!(await first.count())) continue;   // a slate of finals
            // goBack restores the scroll position of the link above, so the first card can be
            // off-screen: a tap at off-screen coordinates lands on nothing.
            const barEl = first.locator('[role="img"][aria-label*="win probability"]').first();
            await barEl.scrollIntoViewIfNeeded();
            const bar = (await barEl.boundingBox())!;
            if (info.project.name === 'mobile') await page.touchscreen.tap(bar.x + bar.width / 2, bar.y + bar.height / 2);
            else await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
            await expect(first.locator('h2 button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
        }
        // Odds tab: FORECAST → the forecast entry, NO BET → the edge section. On a pregame
        // slate (the last loop date can be an archive of finals with no market).
        await page.goto(pregameSlate());
        await settle(page, 300);
        const card = page.locator('article[id]').filter({ has: page.locator('[role="img"][aria-label*="Market:"]') }).first();
        test.skip((await card.count()) === 0, 'no priced game');
        const toggle = card.locator('h2 button[aria-expanded]');
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        await card.getByRole('radio', { name: 'Odds' }).click();
        const forecast = card.getByRole('link', { name: /^Forecast/ });
        await expect(forecast).toHaveAttribute('href', '/methodology#term-model-pct');
        const noBet = card.getByRole('link', { name: /^No bet/i });
        if (await noBet.count()) await expect(noBet).toHaveAttribute('href', '/methodology#edge');
        await tap(forecast);
        await expect(page).toHaveURL(/\/methodology#term-model-pct$/);
        await expect(page.locator('#term-model-pct')).toBeInViewport();
    });

    test('expanded cards never scroll sideways: 10 expand/collapse cycles on every tab (fix4 F4-5)', async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', '1440px check');
        await page.goto('/');
        await settle(page, 300);
        const arts = page.locator('article[id]');
        const n = await arts.count();
        // ~40 toggles and tab switches per card: the budget follows the slate size
        // (a flat 3 min ran out at card 12 of a 13-game slate on the CI runner).
        test.setTimeout(60_000 + n * 30_000);
        for (let i = 0; i < n; i++) {
            const art = arts.nth(i);
            const toggle = art.locator('h2 button[aria-expanded]');
            for (let k = 0; k < 10; k++) {
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                for (const tab of ['Form', 'Lines', 'Odds', 'Why']) {
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

    test('Odds tab: simulator markets per outcome, derivative edges info only with no units', async ({ page }) => {
        await page.goto('/');
        await settle(page, 300);
        const card = page.locator('article[id]').filter({ has: page.locator('h2 button[aria-expanded]') }).first();
        test.skip((await card.count()) === 0, 'no pregame or live game on the slate');
        await card.locator('h2 button[aria-expanded]').click();
        await card.getByRole('radio', { name: 'Odds' }).click();
        const table = card.locator('table[data-markets]');
        test.skip((await table.count()) === 0, 'no market on this game');
        await expect(table).toBeVisible();
        const rows = table.locator('tbody tr[data-market]');
        const keys = await rows.evaluateAll(trs => trs.map(tr => tr.getAttribute('data-market')));
        // When the slate was simulated, every derivative market has a model % (posted prices alone,
        // as in data from before the simulator, can show a REG 3-WAY row without the 1P 3-WAY one).
        const header = readFileSync(join(process.cwd(), 'public/data/predictions_detailed.csv'), 'utf8').split('\n', 1)[0];
        if (header.split(',').includes('sim_status')) {
            for (const k of ['pl', 'total', 'reg', 'reg-tie', 'p1', 'p1-tie', 'p1-2w']) expect(keys, k).toContain(k);
            await expect(table.locator('tr[data-market="pl"] th')).toContainText(/PL/);
            await expect(table.locator('tr[data-market="total"] th')).toContainText(/^O [\d.]+ U$/);
            await expect(table.locator('tr[data-market="reg"] th')).toContainText(/REG 3-WAY/i);
            await expect(table.locator('tr[data-market="p1"] th')).toContainText(/1P 3-WAY/i);
            await expect(table.locator('tr[data-market="p1-2w"] th')).toContainText(/1P 2-WAY/i);
        }
        for (const r of await table.locator('tr[data-gated]').all()) {
            const text = await r.innerText();
            expect(text).not.toMatch(/\b\d+(\.\d)?u\b/);
            expect(text).not.toMatch(/\+EV|NaN/);
            // Percentages to one decimal, American odds signed.
            for (const n of text.match(/\b\d+\.\d+\b/g) ?? []) expect(n).toMatch(/^\d+\.\d$/);
        }
        if (await card.locator('[data-ev="info-only"]').count()) {
            await expect(card.getByRole('link', { name: /^Info only/ })).toHaveAttribute('href', '/methodology#term-sim-edge');
        }
        const axe = await blockingAxeViolations(page);
        expect(axe, formatAxe(axe)).toEqual([]);
    });

    test('Odds tab markets fit a 375px phone without sideways scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/');
        await settle(page, 300);
        const arts = page.locator('article[id]').filter({ has: page.locator('h2 button[aria-expanded]') });
        const n = await arts.count();
        test.skip(n === 0, 'no pregame or live game on the slate');
        for (let i = 0; i < n; i++) {
            const art = arts.nth(i);
            await art.locator('h2 button[aria-expanded]').click();
            await art.getByRole('radio', { name: 'Odds' }).click();
            await page.waitForTimeout(60);
            const m = await art.evaluate(el => {
                const region = el.querySelector('[role="region"]') as HTMLElement;
                const table = el.querySelector('table[data-markets]');
                return {
                    left: el.scrollLeft,
                    sw: el.scrollWidth,
                    cw: el.clientWidth,
                    rsw: region.scrollWidth,
                    rcw: region.clientWidth,
                    tw: table ? table.getBoundingClientRect().width : 0,
                };
            });
            expect(m.left, `card ${i}`).toBe(0);
            expect(m.sw, `card ${i}`).toBeLessThanOrEqual(m.cw + 1);
            expect(m.rsw, `card ${i} region`).toBeLessThanOrEqual(m.rcw + 1);
            expect(m.tw, `card ${i} table`).toBeLessThanOrEqual(m.rcw + 1);
            expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
            await art.locator('h2 button[aria-expanded]').click();
        }
    });

    test('goalie names keep their surname next to IR chips (fix4 F4-6)', async ({ page }) => {
        await page.goto('/');
        await settle(page, 300);
        // Every expandable card tonight (finals don't expand), not one fixed date that goes final.
        const games = page.locator('article[id]').filter({ has: page.locator('h2 button[aria-expanded]') });
        const n = await games.count();
        test.skip(n === 0, 'no pregame or live game on the slate');
        for (let i = 0; i < n; i++) {
            const art = games.nth(i);
            await art.locator('h2 button[aria-expanded]').click();
            await art.getByRole('radio', { name: 'Lines' }).click();
            await page.waitForTimeout(400);
            const names = await art.locator('[data-goalie-name]').evaluateAll(els =>
                els.filter(e => e.getClientRects().length > 0).map(e => ({ text: (e.textContent ?? '').trim(), w: e.getBoundingClientRect().width, full: e.scrollWidth <= e.clientWidth + 1 })),
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
        await page.goto(pregameSlate());
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
        // A coin-flip pregame (rounds to 50.0%) is graded "No lean" instead of right/wrong.
        await expect(card).toContainText(/Model pick (right|wrong)|No lean/);
        await expect(card.locator('[role="img"][aria-label^="Pregame win probability"]')).toHaveAttribute('data-dimmed', 'true');
        await expect(card).not.toContainText('Edge');
        expect(await card.innerText()).not.toMatch(/\b\d+(\.\d)?u\b/);
    });

    test('a LIVE game shows period and clock, pregame % dimmed, no edge', async ({ page }) => {
        await page.goto(pregameSlate());
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
        await page.goto(pregameSlate());
        const [first] = await slateGames(page);
        const ids = Object.keys(await gameIds(page));
        await page.clock.setFixedTime(new Date(new Date(first.start).getTime() + 3 * 3600_000));
        let calls = 0;
        await page.route('**/api/scores?**', route => {
            calls++;
            return scoresFor(route, ids.map(id => ({ id, state: 'OFF', away: 3, home: 2, period: 3, periodType: 'REG', clock: '00:00', last: 'REG' })));
        });
        await page.reload();
        await expect(page.locator('article[id]').first()).toContainText('FINAL');
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
        await settle(page);
        const nav = page.getByRole('navigation', { name: 'Game day' });
        // The last day that isn't already showing: after midnight ET (before the
        // morning rebuild drops yesterday) the default slate is the last chip, and
        // clicking the current chip is a no-op that leaves the URL at "/".
        const others = nav.locator('a:not([aria-current])');
        test.skip((await others.count()) === 0, 'a single game day');
        const href = (await others.last().getAttribute('href'))!;
        const tab = nav.locator(`a[href="${href}"]`);
        await tab.click();
        await expect(page).toHaveURL(new RegExp(`\\${href.replace('/', '')}$`));
        await expect(tab).toHaveAttribute('aria-current', 'date');
        await page.reload();
        await expect(tab).toHaveAttribute('aria-current', 'date');
        await page.goto(href);
        await expect(tab).toHaveAttribute('aria-current', 'date');
        await expect(nav.locator('a[aria-current]')).toHaveCount(1);
    });

    test('until 3:00 am ET last night stays Tonight, and other days still open by URL', async ({ page }) => {
        // Just after midnight ET the night after the last slate (05:30Z = 01:30 EDT / 00:30 EST): its late
        // West-coast games can still be on, so it is still the default slate and its chip still says Tonight.
        const last = pregameSlate().split('=')[1];
        const next = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        await page.clock.setFixedTime(new Date(`${next}T05:30:00Z`));
        await page.goto('/');
        await settle(page);
        const nav = page.getByRole('navigation', { name: 'Game day' });
        await expect(nav.getByRole('link').last()).toHaveAttribute('aria-current', 'date');
        await expect(nav.getByRole('link').last()).toContainText('Tonight');
        await expect(nav.locator('a[aria-current]')).toHaveCount(1);
        const others = nav.locator('a:not([aria-current])');
        test.skip((await others.count()) === 0, 'a single game day');
        const href = (await others.last().getAttribute('href'))!;
        await nav.locator(`a[href="${href}"]`).click();
        await expect(page).toHaveURL(new RegExp(`\\${href.replace('/', '')}$`));
        await page.reload();
        await settle(page);
        await expect(page).toHaveURL(new RegExp(`\\${href.replace('/', '')}$`));
        await expect(nav.locator(`a[href="${href}"]`)).toHaveAttribute('aria-current', 'date');
        await expect(nav.locator('a[aria-current]')).toHaveCount(1);
    });

    test('from 3:00 am ET the night before is Yesterday', async ({ page }) => {
        // 08:30Z the night after the last slate = 04:30 EDT / 03:30 EST: the slate day has rolled over.
        const last = pregameSlate().split('=')[1];
        const next = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        await page.clock.setFixedTime(new Date(`${next}T08:30:00Z`));
        await page.goto('/');
        await settle(page);
        const nav = page.getByRole('navigation', { name: 'Game day' });
        await expect(nav.locator(`a[href="/?date=${last}"]`)).toContainText('Yesterday');
        await expect(nav.getByRole('link', { name: /Tonight/ })).toHaveCount(0);
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

test.describe('odds-history API', () => {
    test('rejects path traversal with 400', async ({ request }) => {
        const res = await request.get('/api/odds-history?gameId=1&date=../../pipeline/nhl_historical_shots');
        expect(res.status()).toBe(400);
    });
});
