import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { isTeamTricode } from '@/utils/team-stats/teams';

/** Per-team <title> and description. */
export async function generateMetadata({ params }: { params: Promise<{ teamAbbr: string }> }): Promise<Metadata> {
    const { teamAbbr } = await params;
    const tri = teamAbbr.toUpperCase();
    const team = TEAM_NAMES[tri];
    if (!team) return { title: 'Team' };
    return {
        title: `${team.name} stats and predictions`,
        description: `${team.name} (${tri}) record, next-game win forecast, game log, expected goals, goalies and skater impact on Pony xG.`,
        alternates: { canonical: `/teams/${tri}` },
    };
}

/** Guard for any runtime render (the page sets dynamicParams = false). */
export default async function TeamLayout({ children, params }: { children: React.ReactNode; params: Promise<{ teamAbbr: string }> }) {
    const { teamAbbr } = await params;
    const tri = teamAbbr.toUpperCase();
    if (!isTeamTricode(tri)) notFound();
    if (tri !== teamAbbr) permanentRedirect(`/teams/${tri}`);
    return children;
}
