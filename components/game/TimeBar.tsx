'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { INTERMISSION, periodLength as basePeriodLength } from '@/lib/game/clock';

export { clockSeconds } from '@/lib/game/clock';

/** A power play's full length from what is left: the smallest of a minor, a double minor or a major that holds it. */
export const ppLength = (left: number) => (left <= 120 ? 120 : left <= 240 ? 240 : 300);

/** A period's length: 20 minutes, or the overtime length past the third (5 in the regular season, 20 in the playoffs). */
export const periodLength = (period: number | null, otLength: number) => basePeriodLength(period ?? 1, otLength);

/** A break's full length: 18 minutes, or what is left if a longer one was scheduled. */
export const breakLength = (left: number) => Math.max(INTERMISSION, left);

/**
 * A hairline along the bottom of a chip or card showing the time still to run: it shrinks toward the
 * left as the clock counts down. Draws in the current text colour; the parent must be `relative`.
 */
export function TimeBar({ left, total, className }: { left: number | null; total: number; className?: string }) {
    if (left == null || total <= 0) return null;
    const share = Math.max(0, Math.min(1, left / total));
    return (
        <span className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-current/20', className)} aria-hidden="true">
            <span className="block h-full bg-current transition-[width] duration-1000 ease-linear" style={{ width: `${share * 100}%` }} />
        </span>
    );
}

/**
 * Seconds left on a clock that never stops (an intermission), ticking down locally from the last
 * reading; a new reading (the page's refresh) starts it over, so it never drifts far from the feed.
 */
export function useCountdown(seconds: number | null): number | null {
    const [elapsed, setElapsed] = React.useState(0);
    React.useEffect(() => {
        if (seconds == null) return;
        const t0 = Date.now();
        const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
        return () => {
            window.clearInterval(id);
            setElapsed(0);
        };
    }, [seconds]);
    return seconds == null ? null : Math.max(0, seconds - elapsed);
}

/** "3:28" from 208. */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const periodName = (p: number) => (p <= 3 ? `P${p}` : p === 4 ? 'OT' : `${p - 3}OT`);

/**
 * An intermission in progress: "End P2 3:28", the break counting down live, with its hairline
 * draining from 18:00. Sits inside a `relative` chip or card.
 */
export function BreakClock({ period, left, bar = true }: { period: number; left: number | null | undefined; bar?: boolean }) {
    const now = useCountdown(left ?? null);
    return (
        <>
            End {periodName(period)}
            {now != null ? <span className="tabular-nums"> {mmss(now)}</span> : null}
            {bar && now != null ? <TimeBar left={now} total={breakLength(left ?? now)} /> : null}
        </>
    );
}
