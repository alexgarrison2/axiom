'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { bumpDataEpoch } from '@/lib/fresh';

/** How long a tab can sit in the background before it refreshes on return. */
const STALE_MS = 10 * 60 * 1000;

/**
 * Refreshes a page that comes back after a while (tab switched back to, phone
 * unlocked, page restored from the back/forward cache): the server render is
 * fetched again and client data caches reload (see lib/fresh.ts). Renders
 * nothing.
 */
export function FreshOnReturn() {
    const router = useRouter();
    React.useEffect(() => {
        let since = Date.now();
        const refresh = () => {
            since = Date.now();
            bumpDataEpoch();
            router.refresh();
        };
        const check = () => {
            if (document.visibilityState === 'visible' && Date.now() - since > STALE_MS) refresh();
        };
        const onShow = (e: PageTransitionEvent) => {
            if (e.persisted && Date.now() - since > STALE_MS) refresh();
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('focus', check);
        window.addEventListener('pageshow', onShow);
        return () => {
            document.removeEventListener('visibilitychange', check);
            window.removeEventListener('focus', check);
            window.removeEventListener('pageshow', onShow);
        };
    }, [router]);
    return null;
}

export default FreshOnReturn;
