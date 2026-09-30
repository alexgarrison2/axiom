import { expect, test } from '@playwright/test';
import {
    blockingAxeViolations,
    collectConsoleProblems,
    horizontalOverflow,
    smallTextCensus,
} from './quality';

/*
 * Proves the gate's detectors fire. Each case renders a clean synthetic page,
 * asserts it passes, then injects exactly one regression and asserts that the
 * detector catches it. If someone weakens a detector (say, the font floor or
 * the axe impact filter), these tests fail.
 */

const CLEAN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gate self-test</title>
<style>
  body { margin: 0; background: #05070b; color: #f5f7fa; font: 15px/22px system-ui, sans-serif; }
  main { padding: 16px; max-width: 100%; }
  .muted { color: #a9b4c2; font-size: 11px; }
</style></head>
<body><main>
  <h1>Tonight</h1>
  <p>Oilers at Canucks, 7:00 PM. <span class="muted">Model 58% · Market 55%</span></p>
  <p class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">screen reader text</p>
  <span style="font-size:8px">·</span>
</main></body></html>`;

function inject(html: string, snippet: string): string {
    return html.replace('</main>', `${snippet}</main>`);
}

test('a clean page passes every detector', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.setContent(CLEAN);
    const census = await smallTextCensus(page);
    expect(census.total).toBeGreaterThan(0);
    expect(census.smallCount).toBe(0); // sr-only text and a bare separator do not count
    expect(await blockingAxeViolations(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(problems).toEqual([]);
});

test('an injected 8px text node fails the font floor', async ({ page }) => {
    await page.setContent(inject(CLEAN, '<span style="font-size:8px;color:#fff">PO 12-4</span>'));
    const census = await smallTextCensus(page);
    expect(census.smallCount).toBe(1);
    expect(census.samples[0]).toMatchObject({ text: 'PO 12-4', px: 8 });
});

test('an injected axe violation (low-contrast text) fails', async ({ page }) => {
    await page.setContent(inject(CLEAN, '<p style="color:#262626">Last 10: 6-3-1</p>'));
    const ids = (await blockingAxeViolations(page)).map((v) => v.id);
    expect(ids).toContain('color-contrast');
});

test('an injected axe violation (unnamed button) fails', async ({ page }) => {
    await page.setContent(inject(CLEAN, '<button><svg width="16" height="16"></svg></button>'));
    const ids = (await blockingAxeViolations(page)).map((v) => v.id);
    expect(ids).toContain('button-name');
});

test('a console error or uncaught exception fails', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.setContent(inject(CLEAN, `<script>console.error('boom'); setTimeout(() => { throw new Error('kaboom') });</script>`));
    await page.waitForTimeout(100);
    expect(problems.map((p) => p.type).sort()).toEqual(['console.error', 'pageerror']);
});

test('page-level horizontal scroll is detected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(inject(CLEAN, '<div style="width:600px;height:10px"></div>'));
    expect(await horizontalOverflow(page)).toBeGreaterThan(100);
});
