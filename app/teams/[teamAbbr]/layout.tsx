import type { Metadata } from 'next';
import { TEAM_NAMES } from '@/components/ui/team-color';

/**
 * Per-team <title> and description. The team page itself is a client
 * component, so its metadata lives here.
 */
export async function generateMetadata({ params }: { params: Promise<{ teamAbbr: string }> }): Promise<Metadata> {
    const { teamAbbr } = await params;
    const tri = teamAbbr.toUpperCase();
    const team = TEAM_NAMES[tri];
    if (!team) return { title: 'Team' };
    return {
        title: `${team.name} stats and predictions`,
        description: `${team.name} (${tri}) game log, expected goals, goalies, skater impact and Pony xG win probabilities.`,
        alternates: { canonical: `/teams/${tri}` },
    };
}

export default function TeamLayout({ children }: { children: React.ReactNode }) {
    return children;
}
