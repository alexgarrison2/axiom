import { NextResponse, type NextRequest } from 'next/server';
import { legacyTabDestination } from '@/lib/legacy-tab';

const TEAM_PATH = /^\/teams\/([A-Za-z]{2,3})\/?$/;

/*
 * Two request-time redirects that a page can't do cleanly (pages stream via
 * loading.tsx, so a redirect() there is a 200 with a meta refresh):
 *
 * 1. Old home-page tab links (/?tab=Teams, /?tab=NEWS, /?tab=2026-10-01 …) go
 *    to their real routes with the tab param dropped. Config redirects can't
 *    do this (they carry the query along and match case-sensitively).
 * 2. Lowercase team URLs (/teams/tor, /teams/Tor) 308 to /teams/TOR. The
 *    matcher only admits 2-3 letter slugs with a lowercase letter, so the
 *    canonical uppercase pages never run this.
 */
export function proxy(req: NextRequest) {
    const team = req.nextUrl.pathname.match(TEAM_PATH);
    if (team) {
        const tri = team[1].toUpperCase();
        if (`/teams/${tri}` === req.nextUrl.pathname) return NextResponse.next();
        // Proxy responses need an absolute Location; the query rides along.
        const url = req.nextUrl.clone();
        url.pathname = `/teams/${tri}`;
        return NextResponse.redirect(url, 308);
    }

    const dest = legacyTabDestination(req.nextUrl.searchParams.get('tab'));
    if (!dest) return NextResponse.next();
    const url = req.nextUrl.clone();
    const [pathname, query] = dest.split('?');
    url.pathname = pathname;
    // Keep any other params (?tab=teams&date=… keeps date) unless the tab names its own.
    const params = new URLSearchParams(query ?? req.nextUrl.search);
    params.delete('tab');
    const qs = params.toString();
    url.search = qs ? `?${qs}` : '';
    return NextResponse.redirect(url, 307);
}

export const config = {
    matcher: [
        { source: '/', has: [{ type: 'query', key: 'tab' }] },
        '/teams/:tri([a-z][A-Za-z]{1,2}|[A-Z][a-z][A-Za-z]?|[A-Z]{2}[a-z])',
    ],
};
