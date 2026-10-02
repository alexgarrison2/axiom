import TeamsTable from '@/components/teams-table/TeamsTable';
import { buildLeaguePayload } from '@/utils/team-stats/server';

/**
 * The league table page body for one season. Rendered at build time (each
 * pipeline run redeploys): the chosen season is in the HTML, filters
 * recompute in the browser. The h1 sits in the table's toolbar row.
 */
export default function TeamsView({ season }: { season: string }) {
    const payload = buildLeaguePayload(season);
    return (
        <main className="page pb-tabbar pt-3 md:pb-6 md:pt-4">
            <TeamsTable initial={payload} />
        </main>
    );
}
