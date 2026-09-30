import type { Metadata } from 'next';
import { SEASON_ID } from '@/lib/season';
import { seasonLabel } from '@/utils/team-stats/season';
import TeamsView from './TeamsView';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Teams: standings and team stats',
    description: `Every NHL team's ${seasonLabel(SEASON_ID)} record, goals, special teams, shots, expected goals and ratings in one sortable table, with last season one tap away.`,
    alternates: { canonical: '/teams' },
};

/** The league table, this season. /teams?season=… is rewritten to /teams/season/[season]. */
export default function TeamsPage() {
    return <TeamsView season={SEASON_ID} />;
}
