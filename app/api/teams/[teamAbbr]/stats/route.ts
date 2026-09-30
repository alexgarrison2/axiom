import { NextResponse, type NextRequest } from 'next/server';
import { SEASON_ID } from '@/lib/season';
import { buildTeamPayload } from '@/utils/team-stats/server-team';
import { isTeamTricode, TEAM_TRICODES } from '@/utils/team-stats/teams';
import { jsonResponse } from '@/utils/team-stats/http';

/*
 * One team's current-season payload: its own trimmed game rows, skater and
 * goalie lines, per-game boxscores and a ~1KB league summary (averages and
 * ranks computed here, not 2MB of league games). Prerendered for the 32
 * clubs at build time; every pipeline run redeploys. Past seasons live at
 * /api/teams/{TRI}/stats/{seasonId}; ?season={seasonId} is rewritten there
 * (next.config.ts).
 */
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
    return TEAM_TRICODES.map(teamAbbr => ({ teamAbbr }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ teamAbbr: string }> }) {
    const { teamAbbr } = await params;
    const tri = teamAbbr.toUpperCase();
    if (tri === 'ALL') {
        return jsonResponse({ error: 'Pick one team. The league-wide table is at /api/teams/league/{seasonId}.' }, 400);
    }
    if (!isTeamTricode(tri)) return jsonResponse({ error: 'Team not found' }, 404);
    if (tri !== teamAbbr) return NextResponse.redirect(new URL(`/api/teams/${tri}/stats`, request.url), 308);
    return jsonResponse(await buildTeamPayload(tri, SEASON_ID, { boxscores: true }));
}
