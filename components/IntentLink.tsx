'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Props = React.ComponentProps<typeof Link> & { href: string };

/**
 * A nav link that prefetches on intent (hover, focus, touch) instead of on
 * entering the viewport. The app bar and tab bar are on every page, so
 * viewport prefetch pulled every section's JS (~65KB gzip) into each cold
 * load and pushed the home page over its 200KB JS budget. Intent still
 * gives the route a head start before the click lands.
 */
export function IntentLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }: Props) {
    const router = useRouter();
    const warmed = React.useRef(false);
    const warm = React.useCallback(() => {
        if (warmed.current) return;
        warmed.current = true;
        router.prefetch(href);
    }, [router, href]);

    return (
        <Link
            href={href}
            prefetch={false}
            onMouseEnter={e => {
                warm();
                onMouseEnter?.(e);
            }}
            onFocus={e => {
                warm();
                onFocus?.(e);
            }}
            onTouchStart={e => {
                warm();
                onTouchStart?.(e);
            }}
            {...rest}
        />
    );
}

export default IntentLink;
