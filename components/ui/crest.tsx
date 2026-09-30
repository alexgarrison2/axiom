import * as React from 'react';
import { cn } from '../../lib/utils';

export interface CrestProps {
    /** Team tricode, e.g. "EDM" (/logos/{TRI}.svg, dark-surface variants). */
    tri: string;
    /** Rendered size in px (square). Matchup card: 84–96 desktop, 56–64 mobile. */
    size?: number;
    /** Accessible name. Omit (decorative) when the team name is visible nearby. */
    alt?: string;
    /** Above-the-fold crests: load eagerly with high priority. */
    priority?: boolean;
    className?: string;
}

/**
 * A team crest with the deep drop shadow from the brief. Size it with `size`
 * (or override with responsive classes, e.g. "h-14 w-14 md:h-[84px] md:w-[84px]").
 * Put the team-colour wash on the surrounding panel (`.team-wash` / <Card wash>).
 */
export function Crest({ tri, size = 40, alt = '', priority = false, className }: CrestProps) {
    return (
        // eslint-disable-next-line @next/next/no-img-element -- static SVGs, no optimisation needed
        <img
            src={`/logos/${tri}.svg`}
            alt={alt}
            width={size}
            height={size}
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            className={cn('shrink-0 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.65)]', className)}
        />
    );
}

/** Crest + tricode for dense table rows (20px crest, mono bold abbreviation). */
export function TeamTag({ tri, className, crest = 20 }: { tri: string; className?: string; crest?: number }) {
    return (
        <span className={cn('inline-flex items-center gap-2 font-bold text-fg-1', className)}>
            <Crest tri={tri} size={crest} className="drop-shadow-none" />
            <span>{tri}</span>
        </span>
    );
}

export default Crest;
