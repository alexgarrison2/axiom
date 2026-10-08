import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeading } from '@/components/ui/page-heading';
import { PlayersTabs } from '@/components/players/PlayersTabs';
import { GoalieTable } from '@/components/players/GoalieTable';
import { goalieBoard, goalieRatings } from '@/lib/goalies';
import { loadPonySeason, ponySeasons } from '@/lib/pony/data';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
    title: 'Goalies',
    description: 'NHL goalies: record, save %, GAA, high-danger save %, goals saved above expected from pony xG, quality starts and the model rating.',
    alternates: { canonical: '/players/goalies' },
};

const seasonLabel = (s: string) => `${s.slice(0, 4)}-${s.slice(6)}`;

export default async function GoaliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const sp = await searchParams;
    const seasons = ponySeasons().filter(s => (loadPonySeason(s)?.goalies.length ?? 0) > 0);
    const want = Array.isArray(sp.season) ? sp.season[0] : sp.season;
    const season = seasons.find(s => s === want) ?? seasons[0] ?? null;
    const data = season ? loadPonySeason(season) : null;
    const rows = data ? goalieBoard(data, goalieRatings()) : [];
    // Qualified: a third of the most games any goalie has played (10 in a full season).
    const maxGp = Math.max(0, ...rows.map(r => r.gp));
    const minGp = Math.max(1, Math.min(10, Math.round(maxGp / 3)));

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-4 py-5 md:py-7">
                <PageHeading title="Goalies" actions={<PlayersTabs active="goalies" />} />
                {seasons.length > 1 ? (
                    <nav aria-label="Season" className="flex gap-1.5">
                        {seasons.map(s => (
                            <Link
                                key={s}
                                href={s === seasons[0] ? '/players/goalies' : `/players/goalies?season=${s}`}
                                aria-current={s === season ? 'page' : undefined}
                                className={cn(
                                    'inline-flex h-8 items-center rounded-full border px-3 text-micro uppercase tracking-chip coarse:h-11',
                                    s === season ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                                )}
                            >
                                {seasonLabel(s)}
                            </Link>
                        ))}
                    </nav>
                ) : null}
                {rows.length ? <GoalieTable key={season} rows={rows} defaultMin={minGp} /> : <p className="panel p-card text-caption text-fg-3">No goalie games yet.</p>}
            </div>
        </main>
    );
}
