'use client';

import { useState } from 'react';
import type { Prediction } from '@/types/prediction';
import LineupGrid from '@/components/LineupGrid';
import { Segmented } from '@/components/ui/segmented';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

/**
 * Both projected lineups. On a phone-width card each lineup takes the full
 * width and a team switch keeps the tab under 600px; a wide card shows the
 * two side by side.
 */
export function LineupsPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    const [side, setSide] = useState<'away' | 'home'>('away');
    return (
        <DetailsLoading state={state}>
            {d => (
                <div className="flex flex-col gap-3 py-1">
                    <div className="cq-lg:hidden">
                        <Segmented
                            label="Lineup team"
                            size="sm"
                            value={side}
                            onChange={setSide}
                            options={[
                                { value: 'away', label: p.away.team.commonName },
                                { value: 'home', label: p.home.team.commonName },
                            ]}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 cq-lg:grid-cols-2">
                        <div className={cn(side !== 'away' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.away.team} d={d.away} now={now} />
                        </div>
                        <div className={cn(side !== 'home' && 'hidden cq-lg:block')}>
                            <LineupGrid team={p.home.team} d={d.home} now={now} />
                        </div>
                    </div>
                    <p className="text-micro text-fg-3">
                        <span className="font-bold text-info">Blue</span> = PP1 · <span className="font-semibold text-fg-1">white</span> = PP2 · numbers are player impact (standard deviations vs league average).
                    </p>
                </div>
            )}
        </DetailsLoading>
    );
}

export default LineupsPanel;
