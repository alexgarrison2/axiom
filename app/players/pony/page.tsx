import type { Metadata } from 'next';
import { GS_PARTS } from '@/lib/game/analytics';
import Link from 'next/link';
import { Suspense } from 'react';
import { LedWord } from '@/components/ui/led-word';
import { PlayersTabs } from '@/components/players/PlayersTabs';
import { PonyFilters } from '@/components/pony/PonyFilters';
import { LeaderTable } from '@/components/pony/LeaderTable';
import { PonyNights } from '@/components/pony/PonyNights';
import { leaderboard, loadPonySeason, nightGames, parseFilters, ponySeasons } from '@/lib/pony/data';

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
    const nights = f.view === 'nights';
    const rows = data && !nights ? leaderboard(data, f) : [];
    const games = data && nights ? nightGames(data, f) : null;
    const n = Math.min(rows.length, Math.max(PAGE, Number(Array.isArray(sp.n) ? sp.n[0] : sp.n) || PAGE));
    const dates = data && data.games.size ? (() => {
        const ds = [...data.games.values()].map(g => g.date).sort();
        return { min: ds[0], max: ds[ds.length - 1] };
    })() : null;
    const params = () => new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(x => [k, x] as [string, string]))));
    const more = params();
    more.set('n', String(n + PAGE));
    const href = (patch: Record<string, string | null>) => {
        const q = params();
        for (const [k, v] of Object.entries(patch)) {
            if (v == null) q.delete(k);
            else q.set(k, v);
        }
        return `/players/pony${q.size ? `?${q}` : ''}`;
    };
    const expanded = (Array.isArray(sp.parts) ? sp.parts[0] : sp.parts) === '1';
    const who = f.pos === 'G' ? 'goalies' : f.pos === 'F' ? 'forwards' : f.pos === 'D' ? 'defencemen' : 'players';

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
                <div className="panel flex flex-col gap-4 p-card max-lg:bg-none max-lg:bg-surface-1">
                    <Suspense>
                        <PonyFilters seasons={seasons} dates={dates} />
                    </Suspense>
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-micro uppercase tracking-label text-fg-3">
                        <span className="text-fg-2">{games ? `${games.total} games · ${f.pos === 'G' ? '30' : '10'}+ min` : `${rows.length} ${who}`}</span>
                        <span>{data ? `${data.games.size} games · ${seasonLabel(f.season)}` : 'No games yet'}</span>
                        <span className="max-sm:order-1 max-sm:flex-1 max-sm:basis-48">Goals per game above an average player at his position</span>
                        <Link href="/methodology#pony-score" className="ml-auto underline-offset-4 max-sm:order-2 hover:text-fg-1 hover:underline coarse:py-3">
                            Method
                        </Link>
                    </p>
                    {games ? (
                        <PonyNights best={games.best} worst={games.worst} dates={games.dates} from={f.from} to={f.to} href={href} />
                    ) : rows.length ? (
                        <LeaderTable
                            rows={rows.slice(0, n)}
                            goalies={f.pos === 'G'}
                            sort={f.sort}
                            dir={f.dir}
                            sortHref={k => href(k === f.sort ? { dir: f.dir === 'top' ? 'bottom' : null } : { sort: k === 'avg' ? null : k, dir: null })}
                            expanded={expanded}
                            // Closing the parts drops a sort by one of them (its column goes away).
                            expandHref={href(expanded ? { parts: null, ...((GS_PARTS as string[]).includes(f.sort) ? { sort: null, dir: null } : {}) } : { parts: '1' })}
                        />
                    ) : (
                        <p className="py-10 text-center text-caption text-fg-3">No player matches these filters.</p>
                    )}
                    {n < rows.length ? (
                        <Link href={`/players/pony?${more}`} scroll={false} className="self-center rounded-full border border-line px-4 py-2 text-micro coarse:py-[15px] uppercase tracking-label text-fg-2 hover:border-line-strong hover:text-fg-1">
                            Show {Math.min(PAGE, rows.length - n)} more
                        </Link>
                    ) : null}
                </div>
            </div>
        </main>
    );
}
