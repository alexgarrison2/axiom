import { PageHeading } from '@/components/ui/page-heading';
import TeamsTable from '@/components/teams-table/TeamsTable';
import { buildLeaguePayload } from '@/utils/team-stats/server';

/**
 * The league table page body for one season. Rendered at build time (each
 * pipeline run redeploys): the chosen season is in the HTML, filters
 * recompute in the browser.
 */
export default function TeamsView({ season }: { season: string }) {
    const payload = buildLeaguePayload(season);
    return (
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-5 md:px-6 md:pb-12 md:pt-8">
            <PageHeading
                eyebrow="League table"
                title="Teams"
                description="All 32 clubs. Sort any column; tap a team for its page."
                className="mb-5"
            />
            <TeamsTable initial={payload} />
        </main>
    );
}
