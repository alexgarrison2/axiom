const DAY = 60 * 60 * 24;

/**
 * Cache headers for a JSON response built from pipeline data.
 *
 * The browser gets a plain max-age and then asks again. The CDN's longer hold
 * and its stale-while-revalidate go in CDN-Cache-Control, which Vercel's edge
 * reads ahead of Cache-Control. stale-while-revalidate must stay out of
 * Cache-Control: Vercel forwards that header to the browser unchanged, and a
 * browser honouring it answers the first request after a data refresh from its
 * old copy (for the whole window), so the page shows the previous run's
 * numbers until it is reloaded.
 */
export function dataCacheHeaders(browserSeconds: number, cdnSeconds: number, cdnStaleSeconds = DAY): Record<string, string> {
    return {
        'Cache-Control': `public, max-age=${browserSeconds}, s-maxage=${cdnSeconds}`,
        'CDN-Cache-Control': `max-age=${cdnSeconds}, stale-while-revalidate=${cdnStaleSeconds}`,
    };
}
