'use client';

import * as React from 'react';

/**
 * A game time in the viewer's own time zone. The server renders the Eastern
 * time (so the HTML is never empty); the browser swaps in local time.
 */
export function LocalTime({ utc, className }: { utc: string; className?: string }) {
    const fmt = (tz?: string) =>
        new Date(utc).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
            ...(tz ? { timeZone: tz } : {}),
        });
    const [text, setText] = React.useState(() => fmt('America/New_York'));
    React.useEffect(() => {
        setText(fmt());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [utc]);
    return (
        <time dateTime={utc} className={className} suppressHydrationWarning>
            {text}
        </time>
    );
}

export default LocalTime;
