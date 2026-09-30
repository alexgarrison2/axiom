import { describe, expect, it } from 'vitest';
import nextConfig from '@/next.config';

type Header = { key: string; value: string };

async function headersFor(source: string): Promise<Header[]> {
    const rules = (await nextConfig.headers?.()) ?? [];
    return rules.filter((r) => r.source === source).flatMap((r) => r.headers as Header[]);
}

function maxAge(value: string | undefined): number {
    return Number(value?.match(/(?:^|,\s*)max-age=(\d+)/)?.[1] ?? -1);
}

describe('next.config security headers', () => {
    it('does not advertise the framework', () => {
        expect(nextConfig.poweredByHeader).toBe(false);
    });

    it('sends hardening headers on every route', async () => {
        const h = Object.fromEntries((await headersFor('/:path*')).map((x) => [x.key, x.value]));
        expect(h['X-Content-Type-Options']).toBe('nosniff');
        expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        expect(h['Permissions-Policy']).toContain('camera=()');
        const csp = h['Content-Security-Policy-Report-Only'];
        expect(csp).toContain("frame-ancestors 'self'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toMatch(/img-src[^;]*https:\/\/assets\.nhle\.com/);
        expect(csp).toMatch(/img-src[^;]*https:\/\/cms\.nhl\.bamgrid\.com/);
    });
});

describe('next.config cache headers', () => {
    it('caches logos and images for at least a week', async () => {
        for (const source of ['/logos/:path*', '/images/:path*']) {
            const cc = (await headersFor(source)).find((x) => x.key === 'Cache-Control')?.value;
            expect(maxAge(cc), source).toBeGreaterThanOrEqual(604800);
            expect(cc).toContain('stale-while-revalidate');
        }
    });

    it('lets browsers revalidate pipeline data after a minute but lets the CDN hold it', async () => {
        const cc = (await headersFor('/data/:path*')).find((x) => x.key === 'Cache-Control')?.value;
        expect(maxAge(cc)).toBe(60);
        expect(cc).toMatch(/s-maxage=\d+/);
        expect(cc).toContain('stale-while-revalidate');
    });
});

describe('next.config home caching', () => {
    it('lets the CDN hold / for 5 minutes with stale-while-revalidate, never the browser', async () => {
        const h = Object.fromEntries((await headersFor('/')).map((x) => [x.key, x.value]));
        expect(h['Cache-Control']).toMatch(/\bs-maxage=300\b/);
        expect(h['Cache-Control']).toMatch(/\bmax-age=0\b/);
        expect(h['Cache-Control']).toContain('stale-while-revalidate');
        expect(h['CDN-Cache-Control']).toBe('max-age=300, stale-while-revalidate=600');
    });

    it('never marks RSC requests to / as publicly cacheable', async () => {
        const rules = ((await nextConfig.headers?.()) ?? []).filter((r) => r.source === '/');
        expect(rules.length).toBeGreaterThan(0);
        for (const r of rules) expect(r.missing).toEqual(expect.arrayContaining([{ type: 'header', key: 'rsc' }]));
    });
});

describe('next.config function tracing', () => {
    it('keeps raw pipeline data, backups and binaries out of every function', () => {
        const global = nextConfig.outputFileTracingExcludes?.['/*'] ?? [];
        for (const pattern of ['pipeline/**/*.csv', 'pipeline/**/*.pkl', 'data/*.bak*', '**/*.log', 'public/data/shots.csv', '**/*.pdf', '**/*.xlsx']) {
            expect(global).toContain(pattern);
        }
    });

    it('still ships the SiteHistory snapshots the odds-history API reads', () => {
        expect(nextConfig.outputFileTracingIncludes?.['/api/odds-history']).toContain('public/data/SiteHistory/*.csv');
    });

    it('ships the season schedule to the routes that read it at request time', () => {
        for (const route of ['/news', '/teams/[teamAbbr]']) {
            expect(nextConfig.outputFileTracingIncludes?.[route], route).toContain('pipeline/data/nhl_schedule_*.json');
        }
        // *.json under pipeline/ is not excluded, so the include is not fighting an exclude
        expect((nextConfig.outputFileTracingExcludes?.['/*'] ?? []).some((p) => p.includes('*.json'))).toBe(false);
    });

    it('ships the data-stamp files (manifest may be absent at build time) to every function', () => {
        expect(nextConfig.outputFileTracingIncludes?.['/*']).toEqual(
            expect.arrayContaining(['public/data/manifest.json', 'public/data/last_updated.json', 'data/last_updated.json']),
        );
    });
});
