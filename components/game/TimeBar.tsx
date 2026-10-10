import * as React from 'react';
import { cn } from '@/lib/utils';

/** "13:12" → seconds; null when the clock is missing or unreadable. */
export const clockSeconds = (c: string | null | undefined): number | null => {
    const m = c ? /^(\d+):(\d{2})$/.exec(c.trim()) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A power play's full length from what is left: the smallest of a minor, a double minor or a major that holds it. */
export const ppLength = (left: number) => (left <= 120 ? 120 : left <= 240 ? 240 : 300);

/** A period's length: 20 minutes, or the overtime length past the third (5 in the regular season, 20 in the playoffs). */
export const periodLength = (period: number | null, otLength: number) => ((period ?? 1) <= 3 ? 1200 : otLength);

/**
 * A hairline along the bottom of a chip or card showing the time still to run: it shrinks toward the
 * left as the clock counts down. Draws in the current text colour; the parent must be `relative`.
 */
export function TimeBar({ left, total, className }: { left: number | null; total: number; className?: string }) {
    if (left == null || total <= 0) return null;
    const share = Math.max(0, Math.min(1, left / total));
    return (
        <span className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-current/20', className)} aria-hidden="true">
            <span className="block h-full bg-current transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
        </span>
    );
}
