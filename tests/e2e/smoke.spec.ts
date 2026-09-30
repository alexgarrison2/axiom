import { expect, test } from '@playwright/test';
import routeConfig from '../routes.json';
import {
    blockingAxeViolations,
    collectConsoleProblems,
    formatAxe,
    formatSmallText,
    horizontalOverflow,
    MIN_FONT_PX,
    settle,
    smallTextCensus,
} from './quality';

/*
 * Route smoke + quality gate. Runs for every route in tests/routes.json in both
 * the desktop and mobile projects. Each route fails on:
 *   - an HTTP status >= 400
 *   - any console error or uncaught exception
 *   - axe serious/critical violations (WCAG 2.x A/AA)
 *   - visible text under MIN_FONT_PX (11px)
 *   - page-level horizontal scroll on mobile
 * GATE_ROUTES=/,/teams limits the run to a subset (local debugging only).
 */

const only = process.env.GATE_ROUTES?.split(',').map((s) => s.trim()).filter(Boolean);
const routes = routeConfig.routes.filter((r) => !only || only.includes(r.path));

for (const route of routes) {
    test(`${route.path} passes the quality gate`, async ({ page }, testInfo) => {
        const consoleProblems = collectConsoleProblems(page);

        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(response, `no response for ${route.path}`).not.toBeNull();
        expect(response!.status(), `${route.path} returned HTTP ${response!.status()}`).toBeLessThan(400);
        await settle(page);

        const census = await smallTextCensus(page);
        testInfo.annotations.push({ type: 'text-census', description: `${census.smallCount}/${census.total} under ${MIN_FONT_PX}px` });
        expect.soft(census.smallCount, formatSmallText(census)).toBe(0);

        const axe = await blockingAxeViolations(page);
        expect.soft(axe.length, `axe serious/critical violations on ${route.path}:\n${formatAxe(axe)}`).toBe(0);

        if (testInfo.project.name === 'mobile') {
            const overflow = await horizontalOverflow(page);
            expect.soft(overflow, `${route.path} scrolls sideways by ${overflow}px on mobile`).toBeLessThanOrEqual(1);
        }

        expect(
            consoleProblems,
            `console errors on ${route.path}:\n${consoleProblems.map((p) => `  ${p.type}: ${p.text}`).join('\n')}`,
        ).toEqual([]);
    });
}

test('unknown routes return 404, not 500', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-ci-probe');
    expect(response?.status()).toBe(404);
});
