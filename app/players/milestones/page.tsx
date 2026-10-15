import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import { PlayersTabs } from '@/components/players/PlayersTabs';
import { MilestonesBoard } from '@/components/milestones/MilestonesBoard';
import { NextGameBoard } from '@/components/milestones/NextGameBoard';
import { RecentStrip } from '@/components/milestones/RecentStrip';
import { KINDS, nextGameMilestones, seasonTag, sortMilestones, type Kind } from '@/lib/milestones';
import { readMilestones } from '@/lib/milestones-server';

// Static: every pipeline commit redeploys; the full list is /data/milestones.json.
export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Player milestones',
    description:
        'NHL players closing in on milestones: career round numbers, all-time and franchise lists, streaks, season paces and pony xG, with how far away each is, the projected game and the next game.',
    alternates: { canonical: '/players/milestones' },
};

/** First screen of the board (the rest loads from the static file). */
const PREVIEW = 40;

export default function MilestonesPage() {
    const doc = readMilestones();
    const since = seasonTag(doc?.since_ixg ?? null);
    const night = doc ? nextGameMilestones(doc) : null;
    const preview = doc ? sortMilestones(doc.items, 'soon').slice(0, PREVIEW) : [];
    const ids = new Set(preview.map(m => String(m.p)));
    const counts = Object.fromEntries(KINDS.map(k => [k.key, doc ? doc.items.filter(m => k.key === 'all' || m.kind === k.key).length : 0])) as Record<Kind | 'all', number>;

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-6 py-5 md:py-7">
                <PageHeading title="Milestones" actions={<PlayersTabs active="milestones" />} />
                {!doc ? (
                    <p className="panel p-card text-caption text-fg-3">No milestones yet.</p>
                ) : (
                    <>
                        {night?.date ? <NextGameBoard doc={doc} date={night.date} items={night.items} total={night.total} sinceTag={since} /> : null}
                        <RecentStrip doc={doc} />
                        <MilestonesBoard
                            preview={{ items: preview, players: Object.fromEntries(Object.entries(doc.players).filter(([id]) => ids.has(id))), next: doc.next }}
                            counts={counts}
                            src="/data/milestones.json"
                            sinceTag={since}
                        />
                    </>
                )}
            </div>
        </main>
    );
}
