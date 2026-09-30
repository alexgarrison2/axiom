'use client';

import type { GameDetails } from '@/lib/client-data';

export type DetailsState = { status: 'loading' } | { status: 'ready'; data: GameDetails | null } | { status: 'error' };

/** Loading / error states for a details tab that needs /api/matchup-details. */
export function DetailsLoading({ state, children }: { state: DetailsState; children: (d: GameDetails) => React.ReactNode }) {
    if (state.status === 'loading') {
        return (
            <div aria-busy="true" className="flex flex-col gap-2 py-1">
                <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
                <div className="h-24 animate-pulse rounded-[10px] bg-surface-2" />
            </div>
        );
    }
    if (state.status === 'error' || !state.data) {
        return <p className="label py-4 text-center">Unavailable</p>;
    }
    return <>{children(state.data)}</>;
}
