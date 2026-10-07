import * as React from 'react';

/**
 * Data freshness for long-lived tabs. The site's data updates hourly, but a
 * phone keeps a tab alive for hours and resumes it without a reload, so a
 * page could keep showing last night's numbers. When a tab comes back after a
 * while, <FreshOnReturn> bumps this epoch and re-renders the page from the
 * server; client-side caches keyed by the epoch fetch their data again.
 */
let epoch = 0;
const subs = new Set<() => void>();

export const dataEpoch = () => epoch;

export function bumpDataEpoch(): void {
    epoch += 1;
    subs.forEach(f => f());
}

function subscribe(f: () => void) {
    subs.add(f);
    return () => {
        subs.delete(f);
    };
}

/** The current data epoch; changes when a stale tab is refreshed. */
export function useDataEpoch(): number {
    return React.useSyncExternalStore(subscribe, dataEpoch, () => 0);
}
