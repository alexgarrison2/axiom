import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import TeamsTable from '@/components/teams-table/TeamsTable';
import { SEASON_ID } from '@/lib/season';
import { buildLeaguePayload } from '@/utils/team-stats/server';
import { seasonLabel } from '@/utils/team-stats/season';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Teams: standings and team stats',
    description: `Every NHL team's ${seasonLabel(SEASON_ID)} record, goals, special teams, shots, expected goals and ratings in one sortable table, with last season one tap away.`,
    alternates: { canonical: '/teams' },
};

/**
 * The league table. Rendered at build time (each pipeline run redeploys):
 * the default view is in the HTML, filters recompute in the browser.
 */
export default function TeamsPage() {
    const payload = buildLeaguePayload(SEASON_ID);
    return (
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-5 md:px-6 md:pb-12 md:pt-8">
            <PageHeading
                eyebrow="League table"
                title="Teams"
                description="Standings and team stats for all 32 clubs. Tap a column to sort, or a team to open its page."
                className="mb-5"
            />
            <TeamsTable initial={payload} />
        </main>
    );
}
