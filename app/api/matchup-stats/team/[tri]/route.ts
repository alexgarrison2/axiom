import { teamGamesPayload } from '@/lib/matchup/matchup-stats-server';
import { TEAM_TRICODES } from '@/utils/team-stats/teams';
import { jsonResponse } from '@/utils/team-stats/http';

/**
 * One team's games over the MATCHUP window (last season + this season) in
 * the /teams compact columns, plus 5v5 xG / TOI and rest buckets. The card
 * fetches the two teams when the tab opens and filters in the browser.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_TRICODES.map(tri => ({ tri }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ tri: string }> }) {
    const { tri } = await params;
    const body = teamGamesPayload(tri.toUpperCase());
    return body ? jsonResponse(body) : jsonResponse({ error: 'Not found' }, 404);
}
