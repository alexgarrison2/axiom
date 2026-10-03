'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches. False on the server and during hydration
 * (so server HTML never depends on the viewport), the real value right after.
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const mql = window.matchMedia(query);
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        },
        [query],
    );
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(query).matches,
        () => false,
    );
}

/** Tailwind's `xl` breakpoint: the width where the home slate switches to the rail + pane. */
export const XL_QUERY = '(min-width: 1280px)';
