import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PonyxGLogo from '@/components/brand/PonyxGLogo';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const pathData = (svg: string) => [...svg.matchAll(/<path[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]);
const size = (p: string) => fs.statSync(path.join(root, p)).size;

describe('PonyxGLogo component', () => {
    it('draws exactly the artwork in public/ponyxG_full.svg', () => {
        const fromFile = pathData(read('public/ponyxG_full.svg'));
        const fromComponent = pathData(renderToStaticMarkup(<PonyxGLogo />));
        expect(fromComponent).toEqual(fromFile);
    });

    it('is a named image by default and hidden when decorative', () => {
        const named = renderToStaticMarkup(<PonyxGLogo className="h-8 w-auto" />);
        expect(named).toContain('role="img"');
        expect(named).toContain('aria-label="Pony xG"');
        expect(named).toContain('class="h-8 w-auto"');
        const decorative = renderToStaticMarkup(<PonyxGLogo title={null} />);
        expect(decorative).toContain('aria-hidden="true"');
        expect(decorative).not.toContain('role="img"');
    });

    it('prefixes internal ids so two logos can share a page', () => {
        const a = renderToStaticMarkup(<PonyxGLogo idPrefix="nav" />);
        expect(a).toContain('id="nav-red-light"');
        expect(a).toContain('url(#nav-light-mask)');
        expect(a).not.toContain('id="pxg-');
    });
});

describe('brand and team asset budgets', () => {
    it('keeps the full logo at or under 30KB and the favicon small', () => {
        expect(size('public/ponyxG_full.svg')).toBeLessThanOrEqual(30 * 1024);
        expect(size('app/icon.svg')).toBeLessThanOrEqual(20 * 1024);
    });

    it('keeps the 33 primary team logos (incl. NHL shield) at or under 220KB total', () => {
        const dir = path.join(root, 'public/logos');
        const primary = fs.readdirSync(dir).filter((f) => /^[A-Z]{3}\.svg$/.test(f));
        expect(primary.length).toBeGreaterThanOrEqual(33);
        const total = primary.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
        expect(total).toBeLessThanOrEqual(220 * 1024);
    });

    it('serves /logos/{TRI}_dark.svg from the dark-variant team files', async () => {
        const { default: nextConfig } = await import('@/next.config');
        const rules = await nextConfig.rewrites?.();
        const list = Array.isArray(rules) ? rules : [...(rules?.beforeFiles ?? []), ...(rules?.afterFiles ?? [])];
        const rule = list.find((r) => r.source.startsWith('/logos/'));
        expect(rule).toEqual({ source: '/logos/:team([A-Z]{3})_dark.svg', destination: '/logos/:team.svg' });
        const teams = fs.readdirSync(path.join(root, 'public/logos')).filter((f) => /^[A-Z]{3}\.svg$/.test(f));
        expect(teams.length).toBe(33); // 32 clubs + NHL shield
    });

    it('keeps network logos tiny (TBS used to embed a 1200px PNG)', () => {
        const dir = path.join(root, 'public/logos/networks');
        for (const f of fs.readdirSync(dir)) expect(size(`public/logos/networks/${f}`), f).toBeLessThanOrEqual(16 * 1024);
    });

    it('keeps the rink background image at or under 90KB', () => {
        expect(size('public/images/nhl_ice_surface.webp')).toBeLessThanOrEqual(90 * 1024);
    });
});
