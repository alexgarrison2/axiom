'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { freshnessState, relativeAge, type FreshnessState } from './freshness';
import { ET_ZONE, formatTime } from '../../lib/format/time';

const dot: Record<FreshnessState, string> = {
    fresh: 'bg-pos',
    ok: 'bg-fg-2',
    stale: 'bg-neg',
    unknown: 'bg-fg-3',
};

const label: Record<FreshnessState, string> = {
    fresh: 'Data is current',
    ok: 'Data is on schedule',
    stale: 'Data is behind schedule',
    unknown: 'Data freshness unknown',
};

/** Tooltip clock with zone: Eastern on the server and first paint, the viewer's zone after mount. */
function clock(d: Date, hydrated: boolean) {
    return formatTime(d, 'datetime', hydrated ? undefined : ET_ZONE) ?? '';
}

/** "7m ago" → "4M", "3h ago" → "3H", "just now" → "NOW". */
function shortAge(rel: string): string {
    if (rel === 'just now') return 'now';
    return rel.replace(/\s*ago$/, '');
}

/**
 * "UPDATED 4M" with a live dot: green glow when fresh, grey when on schedule,
 * red only when a scheduled pipeline run was actually missed (./freshness.ts).
 * Renders a stable placeholder on the server and computes the age after
 * mount (no hydration mismatch); re-checks once a minute.
 */
export function FreshnessBadge({ generatedAt, compact = false, className }: { generatedAt: string | null; compact?: boolean; className?: string }) {
    const [now, setNow] = React.useState<Date | null>(null);

    React.useEffect(() => {
        setNow(new Date());
        const id = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(id);
    }, []);

    const at = generatedAt ? new Date(generatedAt) : null;
    const state: FreshnessState = now ? freshnessState(at, now) : 'unknown';
    const rel = now && at ? relativeAge(at, now) : null;
    const title = at ? `Data updated ${clock(at, now !== null)}` : 'Data update time unknown';

    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap text-micro font-medium uppercase tracking-[0.1em] text-fg-3',
                state === 'stale' && 'text-neg',
                className,
            )}
        >
            <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0 rounded-full', dot[state], state === 'fresh' && 'shadow-[0_0_10px_rgb(var(--pos-rgb))]')} />
            <span className="sr-only">{label[state]}. </span>
            {rel ? (
                <span>
                    {state === 'stale' ? 'Stale ' : compact ? '' : 'Updated '}
                    {shortAge(rel)}
                </span>
            ) : (
                <span>{compact ? 'Data' : 'Updated'}</span>
            )}
        </span>
    );
}

export default FreshnessBadge;
