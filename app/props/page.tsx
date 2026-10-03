import type { Metadata } from 'next';
import PropsBoard from '@/components/props/PropsBoard';
import type { PropGame } from '@/components/props/model';
import { readPublicJson } from '@/components/views/read-data';
import { SEASON_START_YEAR } from '@/lib/season';

// Static: every pipeline commit redeploys; the board itself loads from /data/props.json.
export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Props',
    description: 'NHL player props: shots on goal, goals, points, assists and power-play points. Recent hit rates against the line, book prices and the pony xG fair price.',
    alternates: { canonical: '/props' },
};

const label = (start: number) => `${String(start).slice(2)}-${String(start + 1).slice(2)}`;

export default function PropsPage() {
    const doc = readPublicJson('props.json') as { games?: PropGame[]; slate_date?: string } | null;
    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-4 py-5 md:py-7">
                <PropsBoard
                    src="/data/props.json"
                    games={doc?.games ?? []}
                    slateDate={doc?.slate_date ?? null}
                    seasons={{ cur: label(SEASON_START_YEAR), prev: label(SEASON_START_YEAR - 1) }}
                />
            </div>
        </main>
    );
}
