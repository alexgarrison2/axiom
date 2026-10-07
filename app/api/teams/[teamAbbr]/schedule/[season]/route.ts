import { buildSchedulePayload } from '@/utils/team-stats/schedule-server';
import { isTeamSeason, TEAM_SEASONS } from '@/utils/team-stats/season';
import { isTeamTricode, TEAM_TRICODES } from '@/utils/team-stats/teams';
import { jsonResponse } from '@/utils/team-stats/http';

/** One team's season schedule with rest, density, travel and difficulty (Schedule tab), prerendered. */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_TRICODES.flatMap(teamAbbr => TEAM_SEASONS.map(season => ({ teamAbbr, season })));
}

export async function GET(_request: Request, { params }: { params: Promise<{ teamAbbr: string; season: string }> }) {
    const { teamAbbr, season } = await params;
    if (!isTeamTricode(teamAbbr) || !isTeamSeason(season)) return jsonResponse({ error: 'Not found' }, 404);
    const payload = buildSchedulePayload(teamAbbr, season);
    return payload ? jsonResponse(payload) : jsonResponse({ error: 'No schedule' }, 404);
}
