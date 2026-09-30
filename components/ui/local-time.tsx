'use client';

import { useSyncExternalStore } from 'react';
import { formatTime, formatTimeET, type TimeStyle } from '@/lib/format/time';

const noop = () => () => {};

/**
 * A clock time in the viewer's own zone with its abbreviation ("6:30 PM CDT").
 * The server and first paint render Eastern ("7:30 PM EDT") so the HTML is
 * never empty and hydration matches; the tooltip carries Eastern time.
 */
export function LocalTime({
    iso,
    style = 'time',
    className,
}: {
    iso: string;
    style?: TimeStyle;
    className?: string;
}) {
    const hydrated = useSyncExternalStore(noop, () => true, () => false);
    const et = formatTimeET(iso, style);
    if (!et) return null;
    const text = hydrated ? (formatTime(iso, style) ?? et) : et;
    return (
        <time dateTime={iso} className={className} title={text === et ? undefined : `${et} (Eastern)`}>
            {text}
        </time>
    );
}

export default LocalTime;
