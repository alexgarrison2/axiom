import { loadSeasonGames } from '@/utils/team-stats/server';
import { packGames } from '@/utils/team-stats/game-row';
import { isTeamSeason, TEAM_SEASONS } from '@/utils/team-stats/season';
import { jsonResponse } from '@/utils/team-stats/http';

/** Same as ../games plus per-period splits (only loaded for the Period filter). */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_SEASONS.map(season => ({ season }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    if (!isTeamSeason(season)) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse(packGames(loadSeasonGames(season), { periods: true }));
}
