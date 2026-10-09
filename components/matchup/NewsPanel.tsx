'use client';

import type { Prediction } from '@/types/prediction';
import PlayerNewsList, { listedNews } from '@/components/PlayerNewsList';
import { Crest } from '@/components/ui/crest';
import { DetailsLoading, type DetailsState } from './DetailsLoading';

/** Each team's player news (injuries, lineup moves, returns), away left and home right on a wide card, stacked on a phone. */
export function NewsPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    return (
        <DetailsLoading state={state}>
            {d => (
                <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 cq-lg:grid-cols-2">
                    {(['away', 'home'] as const).map(sd => {
                        const tri = p[sd].team.triCode;
                        const count = listedNews(d[sd].news).length;
                        return (
                            <section key={sd} aria-label={`${p[sd].team.commonName} news`} className="flex min-w-0 flex-col gap-2">
                                <div className="flex items-center gap-2 border-b border-line pb-1.5">
                                    <Crest tri={tri} size={28} className="drop-shadow-none" />
                                    <h3 className="label text-fg-2">
                                        {tri} <span className="text-fg-3">{count}</span>
                                    </h3>
                                </div>
                                {count ? <PlayerNewsList news={d[sd].news} teamTriCode={tri} /> : <p className="label py-3 text-fg-3">No news</p>}
                            </section>
                        );
                    })}
                </div>
            )}
        </DetailsLoading>
    );
}

export default NewsPanel;
