import { loadSeasonGames } from '@/utils/team-stats/server';
import { packGames } from '@/utils/team-stats/game-row';
import { isTeamSeason, TEAM_SEASONS } from '@/utils/team-stats/season';
import { jsonResponse } from '@/utils/team-stats/http';

/**
 * Every team-game of a season in compact columnar form, without per-period
 * splits (see ../games-full). The Teams table fetches it only when a filter
 * needs game-level rows (Last N, home/away, starters, per-game filters).
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_SEASONS.map(season => ({ season }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    if (!isTeamSeason(season)) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse(packGames(loadSeasonGames(season), { periods: false }));
}
