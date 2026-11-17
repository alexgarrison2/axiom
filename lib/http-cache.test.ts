import { describe, expect, it } from 'vitest';
import { dataCacheHeaders } from './http-cache';

describe('dataCacheHeaders', () => {
    it('keeps stale-while-revalidate away from the browser and gives it to the CDN', () => {
        const h = dataCacheHeaders(300, 3600);
        expect(h['Cache-Control']).toBe('public, max-age=300, s-maxage=3600');
        expect(h['CDN-Cache-Control']).toBe('max-age=3600, stale-while-revalidate=86400');
        expect(dataCacheHeaders(60, 300, 3600)['CDN-Cache-Control']).toBe('max-age=300, stale-while-revalidate=3600');
    });
});
