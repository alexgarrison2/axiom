import { listArchiveSeasons } from '@/components/playoff/archive';
import { playoffsActive } from '@/components/SiteNav';
import { SEASON_ID } from '@/lib/season';

// /playoffs is a pointer, not a page: the running postseason while it is on
// (pipeline/build_playoff_archive.py --season <current> keeps its summary
// fresh), otherwise the most recent archive. A route handler gives a real
// HTTP 307 (a redirect() inside a page streams a 1s meta refresh instead).
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
    const seasons = listArchiveSeasons();
    const target = playoffsActive() && seasons.includes(SEASON_ID) ? SEASON_ID : seasons[0];
    const url = new URL(target ? `/playoffs/${target}` : '/standings', req.url);
    // Keep any query (e.g. ?utm=) and let deep links like #series-b survive (fragments stay client-side).
    url.search = new URL(req.url).search;
    return new Response(null, { status: 307, headers: { Location: url.pathname + url.search, 'Cache-Control': 'public, max-age=0, s-maxage=3600' } });
}
