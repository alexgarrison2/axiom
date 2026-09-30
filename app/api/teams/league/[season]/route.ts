import { buildLeaguePayload } from '@/utils/team-stats/server';
import { isTeamSeason, TEAM_SEASONS } from '@/utils/team-stats/season';
import { jsonResponse } from '@/utils/team-stats/http';

/** The /teams table for a season (default view, computed at build time). */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_SEASONS.map(season => ({ season }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    if (!isTeamSeason(season)) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse(buildLeaguePayload(season));
}
