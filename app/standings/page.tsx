import type { Metadata } from 'next';
import { SEASON_START_YEAR } from '@/lib/season';
import { loadStandingsPage } from '@/components/standings/data';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { Bracket } from '@/components/standings/Bracket';
import { LocalTime } from '@/components/ui/local-time';
import { formatTimeET } from '@/lib/format/time';
import { LikelyMatchups } from '@/components/standings/LikelyMatchups';
import {
    compareProjected,
    compareStandings,
    seedConference,
    STANDINGS_BRACKET_MIN_GP,
    type Conference,
    type ConferenceSeeding,
    type StandingsRow,
} from '@/components/standings/model';

// Standings come from the NHL (cached 30 min); projections from the pipeline.
export const revalidate = 1800;

const SEASON_LABEL = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;

export const metadata: Metadata = {
    title: 'Standings & playoff odds',
    description: `${SEASON_LABEL} NHL standings with projected points, playoff, division and Stanley Cup odds from thousands of simulated seasons.`,
    alternates: { canonical: '/standings' },
};

function seedingFor(rows: StandingsRow[], cmp: typeof compareStandings): Record<Conference, ConferenceSeeding> | null {
    const east = seedConference(rows, 'East', cmp);
    const west = seedConference(rows, 'West', cmp);
    return east && west ? { East: east, West: west } : null;
}

export default async function StandingsPage() {
    const data = await loadStandingsPage();
    const { rows, projectionsCurrent, minGp } = data;
    const bracketIsLive = Number.isFinite(minGp) && minGp >= STANDINGS_BRACKET_MIN_GP;
    const cmp = bracketIsLive ? compareStandings : compareProjected;
    const seeding = bracketIsLive || projectionsCurrent ? seedingFor(rows, cmp) : null;
    const leagueOrder = Object.fromEntries([...rows].sort(cmp).map((r, i) => [r.tri, i]));
    const simulatedAt = data.projectionsAt && formatTimeET(data.projectionsAt, 'datetime') ? data.projectionsAt : null;

    const meta = (
        <>
            {data.standingsSource === 'none' ? <span className="label text-warn">Standings offline</span> : null}
            {projectionsCurrent ? (
                <span className="label">
                    {data.totalSims ? `${data.totalSims.toLocaleString('en-US')} sims` : 'Sims'}
                    {simulatedAt ? (
                        <>
                            {' · '}
                            <LocalTime iso={simulatedAt} style="datetime" />
                        </>
                    ) : null}
                </span>
            ) : (
                <span role="status" className="label text-warn">
                    Odds pending
                </span>
            )}
        </>
    );

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-5 md:px-6 md:py-7">
                <StandingsTable rows={rows} showProjections={projectionsCurrent} meta={meta} />

                {bracketIsLive || projectionsCurrent ? (
                    <section aria-labelledby="bracket-heading" className="flex flex-col gap-3">
                        {bracketIsLive ? (
                            seeding ? (
                                <Bracket
                                    seeding={seeding}
                                    strengths={data.strengths}
                                    leagueOrder={leagueOrder}
                                    title={
                                        <h2 id="bracket-heading" className="heading-section">
                                            Bracket
                                        </h2>
                                    }
                                />
                            ) : (
                                <h2 id="bracket-heading" className="heading-section">
                                    Bracket
                                </h2>
                            )
                        ) : (
                            <>
                                <h2 id="bracket-heading" className="heading-section flex items-center gap-2">
                                    First round
                                    <ProjTag />
                                </h2>
                                <LikelyMatchups rows={rows} totalSims={data.totalSims} />
                                {seeding ? (
                                    <div className="pt-3">
                                        <Bracket
                                            seeding={seeding}
                                            strengths={data.strengths}
                                            leagueOrder={leagueOrder}
                                            title={
                                                <h3 className="heading-section flex items-center gap-2">
                                                    Bracket
                                                    <ProjTag />
                                                </h3>
                                            }
                                        />
                                    </div>
                                ) : null}
                            </>
                        )}
                    </section>
                ) : null}
            </div>
        </main>
    );
}

/** Projected (sim-based), not today's standings. */
function ProjTag() {
    return (
        <abbr title="Projected from the simulations, not today's standings" className="rounded-chip border border-brand/45 px-1.5 font-sans text-micro font-medium tracking-[0.14em] text-brand no-underline">
            PROJ
        </abbr>
    );
}
