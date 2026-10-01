'use client';

import { useState } from 'react';
import type { Prediction } from '@/types/prediction';
import LineupGrid from '@/components/LineupGrid';
import PlayerNewsList from '@/components/PlayerNewsList';
import type { PlayerNewsItem } from '@/utils/data';
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

/** A team's player news, collapsed under its lineup. */
function TeamNews({ news, tri }: { news: PlayerNewsItem[]; tri: string }) {
    if (!news.length) return null;
    return (
        <details className="group mt-2.5 rounded-[10px] border border-line px-3 py-1.5">
            <summary className="flex min-h-7 cursor-pointer list-none items-center justify-between coarse:min-h-11">
                <span className="label">
                    News <span className="text-fg-2">{news.length}</span>
                </span>
                <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                    ▾
                </span>
            </summary>
            <div className="mt-2 pb-1.5">
                <PlayerNewsList news={news} teamTriCode={tri} />
            </div>
        </details>
    );
}

/** A team toggle segment: the crest, as large as the segment allows; the other team's crest is dimmed. */
function Logo({ src, on }: { src: string; on: boolean }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={40} height={40} className={cn('h-10 w-10 object-contain transition-[opacity,filter]', !on && 'opacity-40 grayscale')} />;
}

/**
 * Both projected lineups, injuries and player news. A phone-width card
 * switches between the teams with a crest toggle (news follows the team);
 * a wide card shows them side by side, each with its own news.
 */
export function LineupsPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    const [side, setSide] = useState<'away' | 'home'>('away');
    return (
        <DetailsLoading state={state}>
            {d => (
                <div className="flex min-w-0 flex-col gap-2.5">
                    <div className="cq-lg:hidden">
                        <Segmented
                            label="Lineup team"
                            size="sm"
                            block
                            optionClassName="px-1 py-0.5"
                            value={side}
                            onChange={setSide}
                            options={[
                                { value: 'away', label: <Logo src={p.away.team.logoUrl} on={side === 'away'} />, ariaLabel: p.away.team.triCode },
                                { value: 'home', label: <Logo src={p.home.team.logoUrl} on={side === 'home'} />, ariaLabel: p.home.team.triCode },
                            ]}
                        />
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-3 cq-lg:grid-cols-2">
                        <div className={cn('min-w-0', side !== 'away' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.away.team} d={d.away} now={now} seasonTag={impactTag(d.impactSeason, false)} titleWideOnly />
                            <TeamNews news={d.away.news} tri={p.away.team.triCode} />
                        </div>
                        <div className={cn('min-w-0', side !== 'home' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.home.team} d={d.home} now={now} seasonTag={impactTag(d.impactSeason, true)} titleWideOnly />
                            <TeamNews news={d.home.news} tri={p.home.team.triCode} />
                        </div>
                    </div>
                </div>
            )}
        </DetailsLoading>
    );
}

export default LineupsPanel;
