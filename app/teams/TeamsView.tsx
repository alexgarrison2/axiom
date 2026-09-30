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
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-4 md:px-6 md:pb-10 md:pt-6">
            <TeamsTable initial={payload} />
        </main>
    );
}
