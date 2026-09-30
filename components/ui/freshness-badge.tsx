'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { freshnessState, relativeAge, type FreshnessState } from './freshness';

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

function clock(d: Date) {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * "Updated 7m ago" with a status dot. Red only when a scheduled pipeline run
 * was actually missed (see ./freshness.ts). Renders a stable placeholder on
 * the server and computes the relative time after mount (no hydration
 * mismatch); re-checks once a minute.
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
    const title = at ? `Data updated ${clock(at)}` : 'Data update time unknown';

    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-1/80 px-2.5 py-1 text-caption font-medium text-fg-2',
                state === 'stale' && 'border-neg/40 text-neg',
                className,
            )}
        >
            <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', dot[state], state === 'fresh' && 'shadow-[0_0_8px_rgb(var(--pos-rgb)/0.7)]')} />
            <span className="sr-only">{label[state]}. </span>
            {rel ? (
                <span>
                    {state === 'stale' ? 'Stale · ' : compact ? '' : 'Updated '}
                    {rel}
                </span>
            ) : (
                <span>{compact ? 'Data' : 'Data status'}</span>
            )}
        </span>
    );
}

export default FreshnessBadge;
