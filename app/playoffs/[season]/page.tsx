import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listArchiveSeasons, readArchive } from '@/components/playoff/archive';
import ArchiveExplorer from '@/components/playoff/ArchiveExplorer';
import { TeamLogo } from '@/components/views/TeamLogo';
import type { PlayoffArchive } from '@/components/playoff/types';

// A finished postseason never changes: build it once, serve it from the CDN.
// The page reads only public/data/playoffs/<year>/summary.json; per-game
// analysis JSON is fetched by the browser when a game is opened.
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return listArchiveSeasons().map(season => ({ season }));
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }): Promise<Metadata> {
    const { season } = await params;
    const a = readArchive(season);
    if (!a) return { title: 'Playoffs archive' };
    const champ = a.champion ? a.teams[a.champion]?.name : null;
    return {
        title: `${a.seasonLabel} Playoffs · Archive`,
        description: champ
            ? `Every series and game of the ${a.year} Stanley Cup Playoffs, won by the ${champ}: results, shot maps, expected goals and box scores.`
            : `Series, results, shot maps and expected goals from the ${a.year} Stanley Cup Playoffs.`,
        alternates: { canonical: `/playoffs/${season}` },
    };
}

function Leaders({ archive }: { archive: PlayoffArchive }) {
    const { points, goals, goalies } = archive.leaders;
    const panel = (title: string, rows: { key: string; team: string; name: string; value: string; sub: string }[]) => (
        <section aria-label={title} className="hud-panel flex flex-col gap-2 p-4">
            <h3 className="hud-label">{title}</h3>
            <ol className="flex flex-col gap-1.5">
                {rows.map((r, i) => (
                    <li key={r.key} className="flex items-center gap-2 text-body-sm">
                        <span className="w-4 text-right tabular-nums text-fg-3">{i + 1}</span>
                        <TeamLogo tri={r.team} size={18} />
                        <span className="min-w-0 flex-1 truncate font-semibold text-fg-1">{r.name}</span>
                        <span className="whitespace-nowrap text-caption text-fg-3">{r.sub}</span>
                        <span className="w-12 text-right font-bold tabular-nums text-fg-1">{r.value}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
    return (
        <div className="grid gap-4 md:grid-cols-3">
            {panel(
                'Points',
                points.map(p => ({ key: p.playerId, team: p.team, name: p.name, value: String(p.pts), sub: `${p.g}G ${p.a}A · ${p.gp} GP` })),
            )}
            {panel(
                'Goals (vs expected)',
                goals.map(p => ({ key: p.playerId, team: p.team, name: p.name, value: String(p.g), sub: `${p.ixg.toFixed(1)} xG · ${p.gp} GP` })),
            )}
            {panel(
                'Goalies · saved above expected',
                goalies.map(g => ({
                    key: `${g.team}-${g.name}`,
                    team: g.team,
                    name: g.name,
                    value: `${g.gsax >= 0 ? '+' : '−'}${Math.abs(g.gsax).toFixed(1)}`,
                    sub: `${g.svPct != null ? g.svPct.toFixed(3).replace(/^0/, '') : '—'} · ${g.gp} GP`,
                })),
            )}
        </div>
    );
}

export default async function PlayoffArchivePage({ params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    const archive = readArchive(season);
    if (!archive) notFound();
    const others = listArchiveSeasons().filter(s => s !== season);
    const final = archive.series.find(s => s.round === 4);
    const champ = archive.champion;
    const champName = champ ? archive.teams[champ]?.name ?? champ : null;
    const runnerUp = archive.runnerUp ? archive.teams[archive.runnerUp]?.short ?? archive.runnerUp : null;
    const finalScore = final && champ ? `${Math.max(final.topWins, final.bottomWins)}-${Math.min(final.topWins, final.bottomWins)}` : null;
    const isArchive = archive.status === 'complete';

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-6 md:px-6 md:py-10">
                <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_minmax(0,26rem)]">
                    <div className="flex flex-col justify-end gap-2">
                        <p className="hud-label text-playoff">{isArchive ? 'Archive · final results' : 'Postseason in progress'}</p>
                        <h1 className="text-h2 font-black tracking-tight text-fg-1 md:text-display">
                            {archive.seasonLabel} Playoffs{isArchive ? ' · Archive' : ''}
                        </h1>
                        <p className="max-w-2xl text-body text-fg-2">
                            Every series from the {archive.year} Stanley Cup Playoffs. Pick a series for its games, then open any game for the shot map,
                            expected-goals flow and box score.
                        </p>
                        {others.length ? (
                            <p className="text-body-sm text-fg-3">
                                Other postseasons:{' '}
                                {others.map((s, i) => (
                                    <span key={s}>
                                        {i ? ', ' : ''}
                                        <Link href={`/playoffs/${s}`} className="font-semibold text-brand hover:underline">
                                            {`${s.slice(0, 4)}-${s.slice(6)}`}
                                        </Link>
                                    </span>
                                ))}
                            </p>
                        ) : null}
                    </div>

                    {champ && champName ? (
                        <section
                            aria-label="Stanley Cup champion"
                            className="relative flex items-center gap-4 overflow-hidden rounded-card border border-playoff/40 bg-surface-1 p-5 shadow-card"
                        >
                            <span
                                aria-hidden="true"
                                className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-playoff/25 blur-3xl motion-safe:animate-[goal-light_2.4s_ease-in-out_1]"
                            />
                            <TeamLogo tri={champ} size={84} className="relative drop-shadow-[0_6px_18px_rgba(0,0,0,0.6)]" />
                            <div className="relative flex min-w-0 flex-col gap-0.5">
                                <p className="hud-label text-playoff">{archive.year} Stanley Cup champions</p>
                                <p className="text-h2 font-black uppercase italic leading-none tracking-tight text-fg-1">{champName}</p>
                                {runnerUp && finalScore ? (
                                    <p className="text-body-sm text-fg-2">
                                        Beat the {runnerUp} {finalScore} in the Final
                                    </p>
                                ) : null}
                            </div>
                        </section>
                    ) : null}
                </div>

                <section aria-labelledby="leaders-title" className="flex flex-col gap-3">
                    <h2 id="leaders-title" className="text-title font-bold text-fg-1">
                        Playoff leaders
                    </h2>
                    <Leaders archive={archive} />
                </section>

                <ArchiveExplorer archive={archive} />

                <p className="text-caption text-fg-3">
                    Results from the NHL; expected goals from the Pony xG shot model. Built {archive.generatedAt.slice(0, 10)}. Looking for this season?{' '}
                    <Link href="/standings" className="font-semibold text-brand hover:underline">
                        Standings & playoff odds
                    </Link>
                    .
                </p>
            </div>
        </main>
    );
}
