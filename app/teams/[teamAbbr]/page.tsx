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
import { loadPonySeason, ponySeasons } from '@/lib/pony/data';
import { leagueRates } from '@/lib/pony/team-rates';
import type { LeagueRates } from '@/lib/game/league-ranks';
import type { SeasonGame } from '@/components/team/TeamBreakdown';
import type { FormGame } from '@/components/team/TeamHeader';
import { unpackGames } from '@/utils/team-stats/game-row';

/**
 * The team's games per season that the Breakdown tab can merge (built by scripts/pony_scores.ts), numbered
 * from 1, and the league's per-game rates for ranking them.
 */
function breakdownGames(tri: string): { games: Record<string, SeasonGame[]>; league: Record<string, LeagueRates> } {
    const out: Record<string, SeasonGame[]> = {};
    const league: Record<string, LeagueRates> = {};
    for (const s of ponySeasons()) {
        const data = loadPonySeason(s);
        if (!data) continue;
        league[s] = leagueRates(data, tri);
        const games = [...data.games.values()]
            .filter(g => g.away === tri || g.home === tri)
            .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
        // The goalie credited with each game's decision, for the season goalie cards' W-L-OT.
        const decisions = new Map<number, { goalie: number; result: 'W' | 'L' | 'O' }>();
        for (const r of data.goalies) if (r.team === tri && r.box?.decision) decisions.set(r.game, { goalie: r.player, result: r.box.decision });
        out[s] = games.map((g, i) => {
            const home = g.home === tri;
            const gf = home ? g.homeScore : g.awayScore;
            const ga = home ? g.awayScore : g.homeScore;
            return { id: g.id, num: i + 1, date: g.date, opp: home ? g.away : g.home, home, gf, ga, result: gf > ga ? 'W' : g.outcome !== 'REG' ? 'OTL' : 'L', decision: decisions.get(g.id) ?? null };
        });
    }
    return { games: out, league };
}

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
    const bd = breakdownGames(tri);
    const form: FormGame[] = unpackGames(payload.games)
        .filter(g => g.type === 2)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-10)
        .map(g => ({ id: g.id, date: g.date, opp: g.opp, home: g.home, result: g.result, gf: g.gf, ga: g.ga, xgf: g.xgf, xga: g.xga }));

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
                form={form}
            />

            <div className="mt-4">
                <TeamPageClient initial={payload} seasons={[...TEAM_SEASONS]} breakdown={bd.games} league={bd.league} />
            </div>
        </main>
    );
}
