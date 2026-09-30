'use client';

import type { Prediction } from '@/types/prediction';
import LineupGrid from '@/components/LineupGrid';
import { DetailsLoading, type DetailsState } from './DetailsLoading';

/** Both projected lineups: stacked at full width on a phone, side by side on a wide card. */
export function LineupsPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    return (
        <DetailsLoading state={state}>
            {d => (
                <div className="grid grid-cols-1 gap-4 py-1 cq-lg:grid-cols-2">
                    <LineupGrid team={p.away.team} d={d.away} now={now} />
                    <LineupGrid team={p.home.team} d={d.home} now={now} />
                    <p className="text-micro text-fg-3 cq-lg:col-span-2">
                        <span className="font-bold text-info">Blue</span> = PP1 · <span className="font-semibold text-fg-1">white</span> = PP2 · numbers are player impact (standard deviations vs league average).
                    </p>
                </div>
            )}
        </DetailsLoading>
    );
}

export default LineupsPanel;
