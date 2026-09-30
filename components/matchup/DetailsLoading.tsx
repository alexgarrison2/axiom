'use client';

import type { MatchupDetails } from '@/types/prediction';

export type DetailsState = { status: 'loading' } | { status: 'ready'; data: MatchupDetails | null } | { status: 'error' };

/** Loading / error states for a details tab that needs /api/matchup-details. */
export function DetailsLoading({ state, children }: { state: DetailsState; children: (d: MatchupDetails) => React.ReactNode }) {
    if (state.status === 'loading') {
        return (
            <div aria-busy="true" className="flex flex-col gap-2 py-2">
                <div className="h-5 w-1/3 animate-pulse rounded bg-surface-2" />
                <div className="h-24 animate-pulse rounded-control bg-surface-2" />
            </div>
        );
    }
    if (state.status === 'error' || !state.data) {
        return <p className="py-4 text-center text-body-sm text-fg-2">Couldn&apos;t load this game&apos;s details. Try again in a moment.</p>;
    }
    return <>{children(state.data)}</>;
}
