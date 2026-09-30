'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Keeps a table's header row visible below the sticky app bar while the page
 * scrolls, even though the table sits in a horizontal scroller (where CSS
 * `position: sticky; top` cannot work: the scroller becomes the sticky
 * container). The <thead> cells read `--thead-y` and translate by it, so the
 * one real, accessible header follows the page and still scrolls sideways
 * with its columns. No nested vertical scroll area needed.
 */
export function useStickyHeader(tableRef: RefObject<HTMLTableElement | null>, deps: unknown[] = []) {
    useEffect(() => {
        const table = tableRef.current;
        const thead = table?.tHead;
        if (!table || !thead) return;
        let frame = 0;
        let last = -1;
        const appbar = () => {
            const bar = document.querySelector('header.sticky');
            return bar ? bar.getBoundingClientRect().bottom : 0;
        };
        const update = () => {
            frame = 0;
            const rect = table.getBoundingClientRect();
            const captionH = table.caption ? table.caption.getBoundingClientRect().height : 0;
            const headH = thead.getBoundingClientRect().height;
            const top = Math.max(0, appbar());
            const naturalTop = rect.top + captionH;
            const max = Math.max(0, rect.height - captionH - headH * 2);
            const y = Math.round(Math.min(max, Math.max(0, top - naturalTop)));
            if (y !== last) {
                last = y;
                thead.style.setProperty('--thead-y', `${y}px`);
                thead.toggleAttribute('data-stuck', y > 0);
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        update();
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            if (frame) cancelAnimationFrame(frame);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
