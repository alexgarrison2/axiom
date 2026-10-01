import { leagueReference } from '@/lib/matchup/matchup-stats-server';
import { jsonResponse } from '@/utils/team-stats/http';

/**
 * League reference for the MATCHUP tab: every team's stat values over the
 * window (last season + this season) for each location × rest slice, sorted.
 * Static (built with each data deploy); fetched once per page session.
 */
export const dynamic = 'force-static';

export function GET() {
    return jsonResponse(leagueReference());
}
