import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * app/layout.tsx holds the first paint until the document is parsed with a
 * render-blocking <link rel="expect"> whose target id must never exist: an
 * element with that id would release the paint before React's $RC swap runs,
 * bringing back the skeleton-then-swap long task after FCP (home TBT).
 */
const ROOT = path.resolve(__dirname, '../..');

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : files(p);
        return /\.(tsx|ts|jsx|js|html)$/.test(e.name) ? [p] : [];
    });
}

describe('render gate', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8');
    const id = layout.match(/const RENDER_AFTER_PARSE = "#([\w-]+)"/)?.[1];

    it('the root layout blocks the first paint on an expect link', () => {
        expect(id).toBeTruthy();
        expect(layout).toContain('<link rel="expect" href={RENDER_AFTER_PARSE} blocking="render" />');
    });

    it('no element carries the target id', () => {
        const hits = ['app', 'components', 'lib', 'public']
            .flatMap(d => files(path.join(ROOT, d)))
            .filter(f => new RegExp(`id=["'{\`]+${id}\\b`).test(fs.readFileSync(f, 'utf8')));
        expect(hits).toEqual([]);
    });
});
