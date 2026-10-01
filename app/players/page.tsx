import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import SkaterStatsTable from '@/components/SkaterStatsTable';
import { compactSkaters, DEFAULT_FILTER, filterSkaters, sortSkaters } from '@/components/players/model';
import { readBio, readRatingsDoc } from '@/lib/players/server';
import { statLines } from '@/lib/players/stats-server';
import { asOfLabel, parseRatings } from '@/lib/players/ratings';
import { SEASON_START_YEAR } from '@/lib/season';

// Static: every pipeline commit redeploys, and the full list is a static JSON route.
export const dynamic = 'force-static';

const label = (start: number) => `${start}-${String(start + 1).slice(2)}`;

export const metadata: Metadata = {
    title: 'Players',
    description: 'NHL skater ratings: even-strength offence, defence and net impact per 60 minutes (RAPM), adjusted for linemates, opponents and zone starts.',
    alternates: { canonical: '/players' },
};

export default function PlayersPage() {
    const doc = readRatingsDoc();
    const all = compactSkaters(doc, statLines(), readBio());
    const defaults = sortSkaters(filterSkaters(all, DEFAULT_FILTER), 'net', 'desc');
    const preview = { rows: defaults.slice(0, 50), total: defaults.length };
    const meta = parseRatings(doc);
    // Counting stats open on this season once any skater has played; last season stays a toggle away.
    const curStarted = all.some(p => (p.cur?.gp ?? 0) > 0);

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-4 py-5 md:py-7">
                <PageHeading title="Players" />
                <SkaterStatsTable
                    preview={preview}
                    src="/players/skaters"
                    asOf={asOfLabel(meta.asOf)}
                    seasons={{ cur: label(SEASON_START_YEAR), prev: label(SEASON_START_YEAR - 1) }}
                    defaultSeason={curStarted ? 'cur' : 'prev'}
                />
            </div>
        </main>
    );
}
