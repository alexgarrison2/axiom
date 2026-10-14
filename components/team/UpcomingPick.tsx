'use client';

import * as React from 'react';
import { firstUpcoming } from '@/utils/team-stats/format';

const noop = () => () => {};

/**
 * Shows the child for the first game that is not over yet. The page is
 * prerendered, so the server's pick (the first child) can go stale before the
 * next deploy; the browser re-picks from the start times.
 */
export function UpcomingPick({ starts, none, children }: { starts: (string | null)[]; none: React.ReactNode; children: React.ReactNode }) {
    const i = React.useSyncExternalStore(
        noop,
        () => firstUpcoming(starts, Date.now()),
        () => 0,
    );
    const items = React.Children.toArray(children);
    return <>{i >= 0 && items[i] ? items[i] : none}</>;
}
