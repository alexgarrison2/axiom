import { NextResponse } from 'next/server';
import { dataCacheHeaders } from '@/lib/http-cache';
import { getMatchupDetails } from '@/lib/matchup/details-server';

/**
 * Heavy per-game data for the home slate (lineups with impact values,
 * goalie tandems, injuries, recent games, news), fetched once on the first
 * card expand via lib/client-data.ts. Static; rebuilt with each data deploy
 * and at most hourly.
 */
export const revalidate = 3600;

export function GET() {
    return NextResponse.json(getMatchupDetails(), { headers: dataCacheHeaders(300, 3600) });
}
