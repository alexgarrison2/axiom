import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * A team logo from /logos/{TRI}.svg (the NHL dark-surface variants). Plain
 * <img> on purpose: tables render dozens of these and next/image adds a
 * wrapper and srcset per logo for an SVG that needs neither.
 * Decorative by default (alt="") because a tricode or name always sits next
 * to it; pass `label` when the logo stands alone.
 */
export function TeamLogo({ tri, size = 24, label, className }: { tri: string; size?: number; label?: string; className?: string }) {
    if (!/^[A-Z]{3}$/.test(tri ?? '')) {
        return <span aria-hidden="true" className={cn('inline-block shrink-0 rounded-full bg-surface-3', className)} style={{ width: size, height: size }} />;
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={`/logos/${tri}.svg`}
            alt={label ?? ''}
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            className={cn('shrink-0 object-contain', className)}
            style={{ width: size, height: size }}
        />
    );
}

export default TeamLogo;
