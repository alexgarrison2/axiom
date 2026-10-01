import { compactSkaters } from '@/components/players/model';
import { readBio, readRatingsDoc } from '@/lib/players/server';
import { statLines } from '@/lib/players/stats-server';

// Every rostered skater as compact JSON (ratings + this and last season's
// counting lines), built once per deploy; /players fetches it after first paint.
export const dynamic = 'force-static';

export function GET() {
    const rows = compactSkaters(readRatingsDoc(), statLines(), readBio());
    return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
}
