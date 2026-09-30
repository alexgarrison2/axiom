'use client';

import { useSyncExternalStore } from 'react';
import { fmtTime } from '@/lib/matchup/format';

const noop = () => () => {};

/** False during SSR and hydration, true after: lets zone-dependent text swap in without a mismatch. */
export function useHydrated(): boolean {
    return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Puck drop in the viewer's time zone with its abbreviation ("5:00 PM EDT").
 * The server (and the first client paint) renders Eastern time.
 */
export function GameTime({ iso, className }: { iso: string; className?: string }) {
    const hydrated = useHydrated();
    return (
        <time dateTime={iso} className={className}>
            {fmtTime(iso, hydrated ? undefined : 'America/New_York')}
        </time>
    );
}

export default GameTime;
