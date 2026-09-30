import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listArchiveSeasons, readArchive } from '@/components/playoff/archive';
import ArchiveExplorer from '@/components/playoff/ArchiveExplorer';
import { Crest } from '@/components/ui/crest';
import { PageHeading } from '@/components/ui/page-heading';
import { teamColor } from '@/components/ui/team-color';
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
        <section aria-label={title} className="panel min-w-0 overflow-hidden">
            <h2 className="heading-sub border-b border-line px-3 py-2">{title}</h2>
            <ol>
                {rows.map((r, i) => (
                    <li key={r.key} className="flex h-8 items-center gap-2 border-t border-line/60 px-3 text-caption first:border-t-0">
                        <span className="w-3 text-right text-fg-3">{i + 1}</span>
                        <Crest tri={r.team} size={16} className="drop-shadow-none" />
                        <span className="min-w-0 flex-1 truncate font-display text-body-sm font-semibold text-fg-1">{r.name}</span>
                        <span className="whitespace-nowrap text-micro text-fg-3">{r.sub}</span>
                        <span className="w-11 text-right font-bold text-fg-1">{r.value}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
    return (
        <>
            {panel(
                'Points',
                points.map(p => ({ key: p.playerId, team: p.team, name: p.name, value: String(p.pts), sub: `${p.g}G ${p.a}A · ${p.gp}GP` })),
            )}
            {panel(
                'Goals',
                goals.map(p => ({ key: p.playerId, team: p.team, name: p.name, value: String(p.g), sub: `${p.ixg.toFixed(1)} xG · ${p.gp}GP` })),
            )}
            {panel(
                'GSAx',
                goalies.map(g => ({
                    key: `${g.team}-${g.name}`,
                    team: g.team,
                    name: g.name,
                    value: `${g.gsax >= 0 ? '+' : '−'}${Math.abs(g.gsax).toFixed(1)}`,
                    sub: `${g.svPct != null ? g.svPct.toFixed(3).replace(/^0/, '') : '—'} · ${g.gp}GP`,
                })),
            )}
        </>
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
    const runnerUp = archive.runnerUp ?? null;
    const finalScore = final && champ ? `${Math.max(final.topWins, final.bottomWins)}-${Math.min(final.topWins, final.bottomWins)}` : null;
    const isArchive = archive.status === 'complete';

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-6 py-5 md:py-7">
                <PageHeading
                    title={`${archive.seasonLabel} Playoffs`}
                    tag={isArchive ? 'Final' : 'Live'}
                    actions={
                        others.length ? (
                            <nav aria-label="Other postseasons" className="flex flex-wrap gap-1.5">
                                {others.map(s => (
                                    <Link
                                        key={s}
                                        href={`/playoffs/${s}`}
                                        className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-micro font-medium uppercase tracking-[0.14em] text-fg-2 hover:border-brand hover:text-brand coarse:min-h-11"
                                    >
                                        {`${s.slice(0, 4)}-${s.slice(6)}`}
                                    </Link>
                                ))}
                            </nav>
                        ) : null
                    }
                />

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {champ && champName ? (
                        <section
                            aria-label="Stanley Cup champion"
                            className="panel team-wash flex items-center gap-4 px-4 py-3"
                            style={{ '--ac': teamColor(champ), '--hc': teamColor(champ) } as React.CSSProperties}
                        >
                            <Crest tri={champ} size={72} priority />
                            <div className="flex min-w-0 flex-col gap-1">
                                <p className="label text-brand">{archive.year} Champion</p>
                                <p className="num-pct font-display text-h2 uppercase leading-none text-fg-1">{champName}</p>
                                {runnerUp && finalScore ? (
                                    <p className="text-caption font-bold text-fg-2">
                                        {finalScore} <span className="font-normal text-fg-3">v</span> {runnerUp}
                                    </p>
                                ) : null}
                            </div>
                        </section>
                    ) : null}
                    <Leaders archive={archive} />
                </div>

                <ArchiveExplorer archive={archive} />
            </div>
        </main>
    );
}
