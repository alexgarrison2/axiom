import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LedWord } from '@/components/ui/led-word';
import { PlayersTabs } from '@/components/players/PlayersTabs';
import { PonyFilters } from '@/components/pony/PonyFilters';
import { LeaderTable } from '@/components/pony/LeaderTable';
import { leaderboard, loadPonySeason, parseFilters, ponySeasons } from '@/lib/pony/data';

export const metadata: Metadata = {
    title: 'Pony Score leaders',
    description: 'NHL players ranked by Pony Score, a game measured in goals from pony xG: per game, total or per 60, filtered by dates, last games, home or road, rest and opponent.',
    alternates: { canonical: '/players/pony' },
};

const PAGE = 50;
const seasonLabel = (s: string) => `${s.slice(0, 4)}-${s.slice(6)}`;

export default async function PonyLeadersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const sp = await searchParams;
    const seasons = ponySeasons();
    const f = parseFilters(sp, seasons);
    const data = f.season ? loadPonySeason(f.season) : null;
    const rows = data ? leaderboard(data, f) : [];
    const n = Math.min(rows.length, Math.max(PAGE, Number(Array.isArray(sp.n) ? sp.n[0] : sp.n) || PAGE));
    const dates = data && data.games.size ? (() => {
        const ds = [...data.games.values()].map(g => g.date).sort();
        return { min: ds[0], max: ds[ds.length - 1] };
    })() : null;
    const more = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(x => [k, x] as [string, string]))));
    more.set('n', String(n + PAGE));

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-4 py-5 md:py-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="flex items-center">
                        <span className="sr-only">Pony Score leaders</span>
                        <LedWord text="pony score" className="h-8" />
                    </h1>
                    <PlayersTabs active="pony" />
                </div>
                <div className="panel flex flex-col gap-4 p-card">
                    <Suspense>
                        <PonyFilters seasons={seasons} dates={dates} />
                    </Suspense>
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-micro uppercase tracking-label text-fg-3">
                        <span className="text-fg-2">
                            {rows.length} {f.pos === 'G' ? 'goalies' : f.pos === 'F' ? 'forwards' : f.pos === 'D' ? 'defencemen' : 'players'}
                        </span>
                        <span>{data ? `${data.games.size} games · ${seasonLabel(f.season)}` : 'No games yet'}</span>
                        <span>Goals per game above an average player at his position</span>
                        <Link href="/methodology#pony-score" className="ml-auto underline-offset-4 hover:text-fg-1 hover:underline">
                            Method
                        </Link>
                    </p>
                    {rows.length ? (
                        <LeaderTable rows={rows.slice(0, n)} goalies={f.pos === 'G'} sort={f.sort} />
                    ) : (
                        <p className="py-10 text-center text-caption text-fg-3">No player matches these filters.</p>
                    )}
                    {n < rows.length ? (
                        <Link href={`/players/pony?${more}`} scroll={false} className="self-center rounded-full border border-line px-4 py-2 text-micro uppercase tracking-label text-fg-2 hover:border-line-strong hover:text-fg-1">
                            Show {Math.min(PAGE, rows.length - n)} more
                        </Link>
                    ) : null}
                </div>
            </div>
        </main>
    );
}
