'use client';

import { LocalTime as SiteLocalTime } from '@/components/ui/local-time';

/**
 * A team-page game time ("Thu, Oct 1, 8:00 PM CDT") in the viewer's own zone,
 * via the site-wide <LocalTime> (Eastern on the server, local after hydration).
 */
export function LocalTime({ utc, className }: { utc: string; className?: string }) {
    return <SiteLocalTime iso={utc} style="weekday" className={className} />;
}

export default LocalTime;
