import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SEASON_ID } from '@/lib/season';
import { isTeamSeason, seasonLabel, TEAM_SEASONS } from '@/utils/team-stats/season';
import TeamsView from '../../TeamsView';

/*
 * Prerendered target of the /teams?season={id} rewrite (next.config.ts), so a
 * shared "last season" link paints that season's table straight away instead
 * of swapping it in after hydration (a large layout shift on phones).
 * Seasons the switcher does not offer fall back to /teams, as they always did.
 */

export function generateStaticParams() {
    return TEAM_SEASONS.map(season => ({ season }));
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }): Promise<Metadata> {
    const { season } = await params;
    if (!isTeamSeason(season)) return {};
    return {
        title: `Teams: ${seasonLabel(season)} standings and team stats`,
        description: `Every NHL team's ${seasonLabel(season)} record, goals, special teams, shots, expected goals and ratings in one sortable table.`,
        alternates: { canonical: season === SEASON_ID ? '/teams' : `/teams?season=${season}` },
    };
}

export default async function TeamsSeasonPage({ params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    if (!isTeamSeason(season)) redirect('/teams');
    return <TeamsView season={season} />;
}
