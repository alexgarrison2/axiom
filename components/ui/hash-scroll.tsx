'use client';

import { useEffect } from 'react';

/**
 * On a full page load of /methodology#term-…, the browser looks for the
 * fragment while the route's loading shell is still on screen, finds nothing
 * and never looks again, so a glossary link from another page opened at the
 * top. Once the real content has mounted, bring the target into view (instant,
 * honouring its scroll-margin) unless the browser already did.
 */
export function HashScroll() {
    useEffect(() => {
        let id = '';
        try {
            id = decodeURIComponent(window.location.hash.slice(1));
        } catch {
            return;
        }
        if (!id) return;
        const el = document.getElementById(id);
        if (!el) return;
        const top = el.getBoundingClientRect().top;
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        if (top >= 0 && top <= margin + 48) return;
        el.scrollIntoView({ block: 'start', behavior: 'auto' });
    }, []);
    return null;
}

export default HashScroll;
