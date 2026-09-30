import { buildTeamPayload } from '@/utils/team-stats/server-team';
import { isTeamSeason, TEAM_SEASONS } from '@/utils/team-stats/season';
import { isTeamTricode, TEAM_TRICODES } from '@/utils/team-stats/teams';
import { jsonResponse } from '@/utils/team-stats/http';

/** One team's payload for a given season (this season or last), prerendered. */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_TRICODES.flatMap(teamAbbr => TEAM_SEASONS.map(season => ({ teamAbbr, season })));
}

export async function GET(_request: Request, { params }: { params: Promise<{ teamAbbr: string; season: string }> }) {
    const { teamAbbr, season } = await params;
    if (!isTeamTricode(teamAbbr) || !isTeamSeason(season)) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse(await buildTeamPayload(teamAbbr, season, { boxscores: true }));
}
