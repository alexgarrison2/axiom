'use client';

import { useState } from 'react';
import type { Prediction } from '@/types/prediction';
import LineupGrid from '@/components/LineupGrid';
import { Segmented } from '@/components/ui/segmented';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { SEASON_ID } from '@/lib/season';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { GoalieSection } from './GoaliesPanel';
import { cn } from '@/lib/utils';

/**
 * The muted season tag for the NET values, beside the lineup NET, if the
 * ratings file is ever of another season than this one. Exactly one shows: the away grid's always, the
 * home grid's only on a phone-width card (where one grid shows at a time).
 */
function impactTag(season: string | null | undefined, home: boolean) {
    if (!season || season === SEASON_ID) return null;
    const tag = shortSeasonTag(season);
    return (
        <SeasonTag className={cn(home && 'cq-lg:hidden')}>
            <span title={`NET and ranks: ${tag} ratings`}>{tag}</span>
            <span className="sr-only"> ratings</span>
        </SeasonTag>
    );
}

/** A team toggle segment: the crest, as large as the segment allows; the other team's crest is dimmed. */
function Logo({ src, on }: { src: string; on: boolean }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={40} height={40} className={cn('h-10 w-10 object-contain transition-[opacity,filter]', !on && 'opacity-40 grayscale')} />;
}

/**
 * Both projected lineups, each team's goalies and injuries. A phone-width card
 * switches between the teams with a crest toggle; a wide card shows them side by side.
 * Player news has its own tab.
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
                    {/* Wide card: both teams share two rows (lineup, goalies), so each section starts at the same height. */}
                    <div className="grid min-w-0 grid-cols-1 gap-3 cq-lg:grid-cols-2 cq-lg:grid-rows-[auto_auto]">
                        {(['away', 'home'] as const).map(sd => (
                            <div key={sd} className={cn('flex min-w-0 flex-col gap-3 cq-lg:row-span-2 cq-lg:grid cq-lg:grid-rows-subgrid', side !== sd && 'hidden cq-lg:grid')}>
                                <div className="min-w-0">
                                    <LineupGrid team={p[sd].team} d={d[sd]} now={now} seasonTag={impactTag(d.impactSeason, sd === 'home')} titleWideOnly />
                                </div>
                                <div className="min-w-0">
                                    <GoalieSection p={p} state={state} side={sd} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </DetailsLoading>
    );
}

export default LineupsPanel;
