import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../color';

// Contrast check for the Neon Rink HUD text roles, read straight from :root.
const css = readFileSync(resolve(__dirname, '../../../app/globals.css'), 'utf8');

function token(name: string): string {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`token --${name} not found`);
    return m[1];
}

const surfaces = ['bg', 'surface-1', 'surface-2', 'surface-3'];

describe('design tokens', () => {
    it('--text-3 on --surface-2 is at least 4.5:1', () => {
        expect(contrastRatio(token('text-3'), token('surface-2'))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['text-1', 'text-2', 'text-3'])('%s is AA (4.5:1) on every surface', (role) => {
        for (const s of surfaces) {
            expect(contrastRatio(token(role), token(s)), `${role} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each(['brand', 'pos', 'neg', 'warn', 'info', 'playoff'])('signal %s is AA as text on every surface', (sig) => {
        for (const s of surfaces) {
            expect(contrastRatio(token(sig), token(s)), `${sig} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('brand ink on a solid brand fill is AA', () => {
        expect(contrastRatio(token('brand-ink'), token('brand'))).toBeGreaterThanOrEqual(4.5);
    });

    // Neon Arcade brief (2026-09-30): exact palette values.
    it.each([
        ['bg', '#05070b'],
        ['panel-top', '#0b1019'],
        ['panel-bottom', '#070a10'],
        ['line', '#152031'],
        ['ink', '#e8eef8'],
        ['dim', '#6f7b91'],
        ['mute', '#3b475c'],
        ['cyan', '#29e7ff'],
        ['green', '#3dff8f'],
        ['magenta', '#ff4fd8'],
        ['amber', '#ffc53d'],
        ['red', '#ff5470'],
    ])('--%s is the brief value %s', (name, hex) => {
        expect(token(name).toLowerCase()).toBe(hex);
    });

    it('semantic signals point at the brief palette', () => {
        expect(token('brand')).toBe(token('cyan'));
        expect(token('pos')).toBe(token('green'));
        expect(token('neg')).toBe(token('red'));
        expect(token('warn')).toBe(token('amber'));
        expect(token('model')).toBe(token('magenta'));
        expect(token('text-1')).toBe(token('ink'));
    });
});

describe('typefaces', () => {
    const root = resolve(__dirname, '../../..');
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

    it('loads IBM Plex Sans Condensed via next/font', () => {
        const layout = read('app/layout.tsx');
        expect(layout).toMatch(/import \{ IBM_Plex_Sans_Condensed \} from "next\/font\/google"/);
        expect(layout).toMatch(/style: "italic"/);
    });

    // Retired faces, spelled so a repo-wide grep for them comes back empty.
    const retired = new RegExp(['F', 'ira', '|', 'Arial', ' Black'].join(''), 'i');
    it.each(['app/layout.tsx', 'app/globals.css', 'tailwind.config.js'])('%s uses no retired typeface', (f) => {
        expect(read(f)).not.toMatch(retired);
    });
});
