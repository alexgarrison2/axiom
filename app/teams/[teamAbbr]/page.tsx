import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import TeamHeader from '@/components/team/TeamHeader';
import TeamPageClient from '@/components/team/TeamPageClient';
import TeamSelector from '@/components/TeamSelector';
import { SEASON_ID } from '@/lib/season';
import { leagueStandings } from '@/utils/team-stats/server';
import { buildTeamHero, buildTeamPayload } from '@/utils/team-stats/server-team';
import { leaguesSummary } from '@/utils/team-stats/league-summary';
import { prevSeasonId, seasonLabel, TEAM_SEASONS } from '@/utils/team-stats/season';
import { isTeamTricode, TEAM_TRICODES } from '@/utils/team-stats/teams';

/*
 * Team pages are generated at build time for the 32 clubs (every pipeline run
 * redeploys). Anything else is a hard 404 with the site nav (dynamicParams
 * false: no runtime render, so no streamed soft 404). Links always use the
 * uppercase tricode.
 */
export const dynamicParams = false;

export function generateStaticParams() {
    return TEAM_TRICODES.map(teamAbbr => ({ teamAbbr }));
}

export default async function TeamPage({ params }: { params: Promise<{ teamAbbr: string }> }) {
    const { teamAbbr } = await params;
    const tri = teamAbbr.toUpperCase();
    if (!isTeamTricode(tri)) notFound();
    if (tri !== teamAbbr) permanentRedirect(`/teams/${tri}`);

    const payload = await buildTeamPayload(tri, SEASON_ID);
    const hero = buildTeamHero(tri);
    const prev = prevSeasonId(SEASON_ID);
    const prevRows = leagueStandings(prev).rows;
    const prevStanding = prevRows.find(r => r.tri === tri) ?? null;
    const prevKpis = leaguesSummary(prevRows).kpis(tri);

    return (
        <main className="page pb-tabbar pt-2 md:pb-10 md:pt-4">
            <nav aria-label="Breadcrumb" className="mb-2 flex items-center justify-between gap-3">
                <ol className="flex min-w-0 items-center gap-1.5 text-micro font-medium uppercase tracking-label">
                    <li>
                        <Link href="/teams" className="inline-flex min-h-8 items-center text-fg-3 hover:text-brand coarse:min-h-11">
                            Teams
                        </Link>
                    </li>
                    <li aria-hidden="true" className="text-fg-disabled">
                        /
                    </li>
                    <li aria-current="page" className="truncate text-fg-1">
                        {payload.team.tri}
                    </li>
                </ol>
                <TeamSelector current={tri} />
            </nav>

            <TeamHeader
                team={payload.team}
                seasonLabel={payload.seasonLabel}
                standing={payload.standing}
                kpis={payload.kpis}
                prevLabel={seasonLabel(prev)}
                prevStanding={prevStanding}
                prevKpis={prevKpis}
                hero={hero}
                goalies={payload.goalies}
            />

            <div className="mt-4">
                <TeamPageClient initial={payload} seasons={[...TEAM_SEASONS]} />
            </div>
        </main>
    );
}
