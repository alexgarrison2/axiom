'use client';

import { useSyncExternalStore } from 'react';
import { LocalTime } from '@/components/ui/local-time';

const noop = () => () => {};

/** False during SSR and hydration, true after: lets zone-dependent text swap in without a mismatch. */
export function useHydrated(): boolean {
    return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Puck drop in the viewer's time zone with its abbreviation ("5:00 PM EDT").
 * Thin wrapper over the site-wide <LocalTime> (Eastern on the server, local
 * after hydration, Eastern in the tooltip).
 */
export function GameTime({ iso, className }: { iso: string; className?: string }) {
    return <LocalTime iso={iso} className={className} />;
}

export default GameTime;
