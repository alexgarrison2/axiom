import { compactSkaters } from '@/components/players/model';
import { dataCacheHeaders } from '@/lib/http-cache';
import { readBio, readRatingsDoc } from '@/lib/players/server';
import { ponyForm, statLines } from '@/lib/players/stats-server';

// Every rostered skater as compact JSON (ratings + this and last season's
// counting lines), built once per deploy; /players fetches it after first paint.
export const dynamic = 'force-static';

export function GET() {
    const rows = compactSkaters(readRatingsDoc(), statLines(), readBio(), ponyForm());
    return Response.json(rows, { headers: dataCacheHeaders(300, 3600) });
}
