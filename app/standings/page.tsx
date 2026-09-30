import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeading } from '@/components/ui/page-heading';
import { SEASON_GAMES, SEASON_START_YEAR } from '@/lib/season';
import { loadStandingsPage } from '@/components/standings/data';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { Bracket } from '@/components/standings/Bracket';
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

function fmtWhen(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
}

function seedingFor(rows: StandingsRow[], cmp: typeof compareStandings): Record<Conference, ConferenceSeeding> | null {
    const east = seedConference(rows, 'East', cmp);
    const west = seedConference(rows, 'West', cmp);
    return east && west ? { East: east, West: west } : null;
}

function Pill({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'warn' }) {
    return (
        <span
            className={
                tone === 'warn'
                    ? 'inline-flex items-center rounded-full border border-dashed border-warn/60 px-2.5 py-0.5 text-caption font-semibold text-warn'
                    : 'inline-flex items-center rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 text-caption font-semibold text-brand'
            }
        >
            {children}
        </span>
    );
}

export default async function StandingsPage() {
    const data = await loadStandingsPage();
    const { rows, projectionsCurrent, minGp } = data;
    const bracketIsLive = Number.isFinite(minGp) && minGp >= STANDINGS_BRACKET_MIN_GP;
    const cmp = bracketIsLive ? compareStandings : compareProjected;
    const seeding = bracketIsLive || projectionsCurrent ? seedingFor(rows, cmp) : null;
    const leagueOrder = Object.fromEntries([...rows].sort(cmp).map((r, i) => [r.tri, i]));
    const simulatedAt = fmtWhen(data.projectionsAt);
    const gpNote = !Number.isFinite(minGp) ? null : minGp === 0 ? 'Some teams have not played yet' : `Every team has played at least ${minGp} of ${SEASON_GAMES}`;

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-6 md:px-6 md:py-10">
                <PageHeading
                    eyebrow={`${SEASON_LABEL} season · ${SEASON_GAMES} games`}
                    title="Standings & playoff odds"
                    description="Where every team stands tonight, and how often it finished in each spot across thousands of simulations of the rest of the season."
                />

                <div className="flex flex-wrap items-center gap-2 text-body-sm text-fg-2">
                    {projectionsCurrent ? (
                        <Pill>
                            {data.totalSims ? `${data.totalSims.toLocaleString('en-US')} simulated seasons` : 'Simulated seasons'}
                            {simulatedAt ? ` · ${simulatedAt}` : ''}
                        </Pill>
                    ) : null}
                    {gpNote ? <span className="text-fg-3">{gpNote}.</span> : null}
                    {data.standingsSource === 'none' ? <span className="text-warn">Live standings are unavailable right now; records show 0-0-0.</span> : null}
                </div>

                {!projectionsCurrent ? (
                    <div role="status" className="hud-panel flex flex-col gap-1 border-dashed p-4 md:p-5">
                        <p className="text-title font-bold text-fg-1">Projections updating</p>
                        <p className="max-w-2xl text-body-sm text-fg-2">
                            The {SEASON_LABEL} season simulation hasn&apos;t published yet, so playoff odds are hidden rather than showing last season&apos;s
                            numbers. Standings below are live.
                        </p>
                    </div>
                ) : minGp < 10 ? (
                    <p className="max-w-3xl text-body-sm text-fg-2">
                        <span className="font-semibold text-warn">Early season.</span> With so few games played, the odds lean on preseason team ratings. Bands are
                        wide on purpose.
                    </p>
                ) : null}

                <StandingsTable rows={rows} showProjections={projectionsCurrent} />

                <section aria-labelledby="bracket-heading" className="flex flex-col gap-5">
                    {bracketIsLive ? (
                        <>
                            <div className="flex flex-col gap-1">
                                <h2 id="bracket-heading" className="text-h2 font-black uppercase italic tracking-tight text-fg-1 md:text-display">
                                    If the playoffs started today
                                </h2>
                                <p className="text-body-sm text-fg-2">Seeded from the current standings (points, then points %, regulation wins and wins).</p>
                            </div>
                            {seeding ? <Bracket seeding={seeding} strengths={data.strengths} leagueOrder={leagueOrder} /> : null}
                        </>
                    ) : projectionsCurrent ? (
                        <>
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-3">
                                    <h2 id="bracket-heading" className="text-h2 font-black uppercase italic tracking-tight text-fg-1 md:text-display">
                                        Most likely first-round matchups
                                    </h2>
                                    <Pill>Projected</Pill>
                                </div>
                                <p className="max-w-3xl text-body-sm text-fg-2">
                                    A bracket from today&apos;s standings means little until teams have played about {STANDINGS_BRACKET_MIN_GP} games, so this
                                    shows the series the simulations produced most often.
                                </p>
                            </div>
                            <LikelyMatchups rows={rows} totalSims={data.totalSims} />
                            {seeding ? (
                                <div className="flex flex-col gap-4 pt-2">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <h3 className="text-title font-black uppercase italic tracking-tight text-fg-1 md:text-h2">Projected bracket</h3>
                                        <Pill>Projected</Pill>
                                    </div>
                                    <p className="-mt-2 max-w-3xl text-body-sm text-fg-2">Seeded by projected points, not by the current standings. Build your own path to the Cup.</p>
                                    <Bracket seeding={seeding} strengths={data.strengths} leagueOrder={leagueOrder} />
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <h2 id="bracket-heading" className="text-h2 font-black uppercase italic tracking-tight text-fg-1">
                                Playoff picture
                            </h2>
                            <p className="text-body-sm text-fg-2">
                                The projected bracket returns once the {SEASON_LABEL} projections are published. Until every team has played {STANDINGS_BRACKET_MIN_GP}{' '}
                                games we don&apos;t seed a bracket from the standings.
                            </p>
                        </div>
                    )}
                </section>

                <p className="text-caption text-fg-3">
                    How the simulation works: <Link href="/methodology#players" className="font-semibold text-brand hover:underline">methodology</Link>. Last
                    season&apos;s postseason lives in the{' '}
                    <Link href="/playoffs" className="font-semibold text-brand hover:underline">
                        playoffs archive
                    </Link>
                    .
                </p>
            </div>
        </main>
    );
}
