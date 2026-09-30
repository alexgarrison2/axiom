import { NextResponse, type NextRequest } from 'next/server';
import { legacyTabDestination } from '@/lib/legacy-tab';

/*
 * Old home-page tab links (/?tab=Teams, /?tab=NEWS, /?tab=2026-10-01 …) go to
 * their real routes with the tab param dropped. Config redirects can't do
 * this (they carry the query along and match case-sensitively), and the page
 * itself streams (app/loading.tsx), so a redirect there would be a 200 with a
 * meta refresh. Runs only for "/" requests that carry ?tab=.
 */
export function proxy(req: NextRequest) {
    const dest = legacyTabDestination(req.nextUrl.searchParams.get('tab'));
    if (!dest) return NextResponse.next();
    const url = req.nextUrl.clone();
    const [pathname, query] = dest.split('?');
    url.pathname = pathname;
    url.search = query ? `?${query}` : '';
    return NextResponse.redirect(url, 307);
}

export const config = {
    matcher: [{ source: '/', has: [{ type: 'query', key: 'tab' }] }],
};
