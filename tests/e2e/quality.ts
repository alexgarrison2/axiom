import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/*
 * Shared detectors for the CI quality gate. Each returns plain data so the
 * specs can assert on it and print a readable failure. The same detectors are
 * exercised against synthetic pages in gate-selftest.spec.ts, which proves
 * that an injected regression (8px text, axe violation, console error) fails.
 */

/** Smallest font size allowed for visible text (D1 type scale: micro = 11px). */
export const MIN_FONT_PX = Number(process.env.GATE_MIN_FONT_PX ?? 11);

/** axe impact levels that fail the gate. */
export const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Console messages that are known-benign and must not fail the gate. Keep this
 * list tiny and specific; every entry is a hole in the gate.
 */
const CONSOLE_ALLOWLIST: RegExp[] = [
    // Chrome DevTools noise when a font preload is not used within a few seconds.
    /was preloaded using link preload but not used within a few seconds/,
];

export interface ConsoleProblem {
    type: string;
    text: string;
}

/** Start collecting console errors and uncaught exceptions. Call before goto(). */
export function collectConsoleProblems(page: Page): ConsoleProblem[] {
    const problems: ConsoleProblem[] = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (CONSOLE_ALLOWLIST.some((re) => re.test(text))) return;
        const loc = msg.location();
        problems.push({ type: 'console.error', text: loc?.url ? `${text} (${loc.url})` : text });
    });
    page.on('pageerror', (err) => {
        problems.push({ type: 'pageerror', text: `${err.name}: ${err.message}` });
    });
    return problems;
}

/** Let client-side fetches and hydration settle without hanging on long polls. */
export async function settle(page: Page, ms = 750): Promise<void> {
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(ms);
}

export interface SmallTextNode {
    text: string;
    px: number;
    path: string;
}

export interface TextCensus {
    total: number;
    smallCount: number;
    samples: SmallTextNode[];
}

/**
 * Census of visible text nodes rendered below `minPx`. SVG text is skipped
 * (its computed size ignores viewBox scaling), as are nodes with no letters or
 * digits (separators, bullets) and visually hidden sr-only text.
 */
export async function smallTextCensus(page: Page, minPx = MIN_FONT_PX): Promise<TextCensus> {
    return page.evaluate((min) => {
        const describe = (el: Element): string => {
            const parts: string[] = [];
            let cur: Element | null = el;
            for (let i = 0; cur && i < 3; i++, cur = cur.parentElement) {
                const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
                parts.unshift(cur.tagName.toLowerCase() + (cls ? `.${cls}` : ''));
            }
            return parts.join(' > ');
        };
        const samples: { text: string; px: number; path: string }[] = [];
        let total = 0;
        let smallCount = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
            const el = node.parentElement;
            if (!el || el.closest('svg, script, style, noscript, template')) continue;
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
            const box = el.getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) continue; // sr-only / collapsed
            total++;
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (px < min) {
                smallCount++;
                if (samples.length < 12) samples.push({ text: text.slice(0, 40), px, path: describe(el) });
            }
        }
        return { total, smallCount, samples };
    }, minPx);
}

export interface AxeProblem {
    id: string;
    impact: string;
    help: string;
    nodes: number;
    targets: string[];
}

/** Run axe (WCAG 2.x A/AA) and return serious/critical violations. */
export async function blockingAxeViolations(page: Page): Promise<AxeProblem[]> {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    return results.violations
        .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
        .map((v) => ({
            id: v.id,
            impact: v.impact ?? 'unknown',
            help: v.help,
            nodes: v.nodes.length,
            targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        }));
}

/** Pixels the document is wider than the viewport (page-level sideways scroll). */
export async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return Math.max(0, doc.scrollWidth - window.innerWidth);
    });
}

export function formatAxe(problems: AxeProblem[]): string {
    return problems
        .map((p) => `  [${p.impact}] ${p.id}: ${p.help} (${p.nodes} nodes) e.g. ${p.targets.join(' | ')}`)
        .join('\n');
}

export function formatSmallText(c: TextCensus, minPx = MIN_FONT_PX): string {
    const lines = c.samples.map((s) => `  ${s.px}px "${s.text}"  ${s.path}`);
    return `${c.smallCount} of ${c.total} visible text nodes are under ${minPx}px:\n${lines.join('\n')}`;
}
