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
});
