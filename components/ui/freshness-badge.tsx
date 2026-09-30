'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { freshnessState, freshnessTone, relativeAge, type FreshnessTone } from './freshness';
import { ET_ZONE, formatTime } from '../../lib/format/time';

const dot: Record<FreshnessTone, string> = {
    ok: 'bg-pos',
    amber: 'bg-warn',
    stale: 'bg-neg',
    unknown: 'bg-fg-3',
};

const text: Record<FreshnessTone, string> = {
    ok: 'text-fg-3',
    amber: 'text-warn',
    stale: 'text-neg',
    unknown: 'text-fg-3',
};

const label: Record<FreshnessTone, string> = {
    ok: 'Data on schedule',
    amber: 'Data update late',
    stale: 'Data stale',
    unknown: 'Data freshness unknown',
};

/** Clock with zone: Eastern on the server and first paint, the viewer's zone after mount. */
function clock(d: Date, hydrated: boolean) {
    return formatTime(d, 'datetime', hydrated ? undefined : ET_ZONE) ?? '';
}

/** "7m ago" → "7M", "3h ago" → "3H", "just now" → "NOW". */
function shortAge(rel: string): string {
    if (rel === 'just now') return 'now';
    return rel.replace(/\s*ago$/, '');
}

export interface FreshnessBadgeProps {
    /** ISO UTC of the last pipeline run. */
    generatedAt: string | null;
    /** ISO UTC puck drops around today (drives the game-day and missed-pregame rules). */
    starts?: readonly string[] | null;
    compact?: boolean;
    className?: string;
}

/**
 * "UPDATED 4M" with a live dot. Calm (dim text, green dot) while on schedule,
 * amber "UPDATED 3H" when a run slot was missed, red "STALE" only when the
 * data is really behind (./freshness.ts). Hover shows the timestamp as a
 * title; tap/click/Enter toggles a small timestamp popover for touch.
 * Renders a stable placeholder on the server and computes the age after
 * mount (no hydration mismatch); re-checks once a minute.
 */
export function FreshnessBadge({ generatedAt, starts, compact = false, className }: FreshnessBadgeProps) {
    const [now, setNow] = React.useState<Date | null>(null);
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLSpanElement>(null);
    const popId = React.useId();

    React.useEffect(() => {
        setNow(new Date());
        const id = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(id);
    }, []);

    React.useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const at = generatedAt ? new Date(generatedAt) : null;
    const startDates = React.useMemo(() => (starts ? starts.map(s => new Date(s)) : null), [starts]);
    const tone: FreshnessTone = now ? freshnessTone(freshnessState(at, now, { starts: startDates })) : 'unknown';
    const rel = now && at ? relativeAge(at, now) : null;
    const stamp = at ? clock(at, now !== null) : null;

    return (
        <span ref={rootRef} className={cn('relative inline-flex', className)}>
            <button
                type="button"
                title={stamp ? `Updated ${stamp}` : undefined}
                aria-expanded={open}
                aria-controls={popId}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'relative inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-chip text-micro font-medium uppercase tracking-[0.1em] transition-colors',
                    // 44px hit area on touch without growing the bar
                    "coarse:before:absolute coarse:before:-inset-2 coarse:before:content-['']",
                    text[tone],
                    tone === 'ok' && 'hover:text-fg-1',
                )}
            >
                <span
                    aria-hidden="true"
                    className={cn('h-[7px] w-[7px] shrink-0 rounded-full', dot[tone], tone === 'ok' && 'shadow-[0_0_10px_rgb(var(--pos-rgb))]')}
                />
                <span className="sr-only">{label[tone]}. </span>
                {rel ? (
                    <span>
                        {tone === 'stale' ? 'Stale ' : compact ? '' : 'Updated '}
                        {shortAge(rel)}
                    </span>
                ) : (
                    <span>{compact ? 'Data' : 'Updated'}</span>
                )}
            </button>
            <span
                id={popId}
                role="status"
                hidden={!open}
                className="absolute right-0 top-full z-[70] mt-1.5 whitespace-nowrap rounded-control border border-line-strong bg-surface-1 px-3 py-2 text-micro uppercase tracking-[0.1em] animate-pop-in"
            >
                <span className="text-fg-3">Updated </span>
                <span className="tabular-nums text-fg-1">{stamp ?? '—'}</span>
            </span>
        </span>
    );
}

export default FreshnessBadge;
