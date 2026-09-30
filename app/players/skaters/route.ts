import { compactSkaters } from '@/components/players/model';
import { readPublicJson } from '@/components/views/read-data';

// Every skater as compact JSON (~30KB gzipped instead of the 1.1MB
// player_impact.json), built once per deploy; /players fetches it after
// first paint.
export const dynamic = 'force-static';

export function GET() {
    const rows = compactSkaters(readPublicJson('player_impact.json'), readPublicJson('player_bio.json'));
    return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
}
