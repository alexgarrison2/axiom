'use client';

import { useState } from 'react';
import type { Prediction } from '@/types/prediction';
import LineupGrid from '@/components/LineupGrid';
import PlayerNewsList from '@/components/PlayerNewsList';
import { Segmented } from '@/components/ui/segmented';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { SEASON_ID } from '@/lib/season';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

/**
 * The muted season tag for the impact values, beside GRADE, while they come
 * from last season's ratings. Exactly one shows: the away grid's always, the
 * home grid's only on a phone-width card (where one grid shows at a time).
 */
function impactTag(season: string | null | undefined, home: boolean) {
    if (!season || season === SEASON_ID) return null;
    const tag = shortSeasonTag(season);
    return (
        <SeasonTag className={cn(home && 'cq-lg:hidden')}>
            <span title={`Impact and ranks: ${tag} ratings`}>{tag}</span>
            <span className="sr-only"> ratings</span>
        </SeasonTag>
    );
}

/**
 * Both projected lineups, injuries and player news. A phone-width card
 * switches between the teams; a wide card shows them side by side.
 */
export function LineupsPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    const [side, setSide] = useState<'away' | 'home'>('away');
    return (
        <DetailsLoading state={state}>
            {d => (
                <div className="flex flex-col gap-2.5">
                    <div className="cq-lg:hidden">
                        <Segmented
                            label="Lineup team"
                            size="sm"
                            value={side}
                            onChange={setSide}
                            options={[
                                { value: 'away', label: p.away.team.triCode },
                                { value: 'home', label: p.home.team.triCode },
                            ]}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-3 cq-lg:grid-cols-2">
                        <div className={cn(side !== 'away' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.away.team} d={d.away} now={now} seasonTag={impactTag(d.impactSeason, false)} />
                        </div>
                        <div className={cn(side !== 'home' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.home.team} d={d.home} now={now} seasonTag={impactTag(d.impactSeason, true)} />
                        </div>
                    </div>
                    {d.away.news.length || d.home.news.length ? (
                        <details className="group rounded-[10px] border border-line px-3 py-1.5">
                            <summary className="flex min-h-7 cursor-pointer list-none items-center justify-between coarse:min-h-11">
                                <span className="label">News</span>
                                <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                                    ▾
                                </span>
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-3 pb-1.5 cq-sm:grid-cols-2">
                                <PlayerNewsList news={d.away.news} teamTriCode={p.away.team.triCode} />
                                <PlayerNewsList news={d.home.news} teamTriCode={p.home.team.triCode} />
                            </div>
                        </details>
                    ) : null}
                </div>
            )}
        </DetailsLoading>
    );
}

export default LineupsPanel;
