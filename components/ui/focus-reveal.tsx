'use client';

import { useEffect } from 'react';

/**
 * Keyboard focus must never land out of sight (WCAG 2.2 SC 2.4.11). Browsers
 * only half-do this for horizontally scrolling rows: Chrome leaves a control
 * that is a few pixels on screen where it is (e.g. the "All teams" select at
 * the end of the /players filter chips, or the last sortable header of a
 * wide table on a phone). On keyboard focus, bring the focused control fully
 * into view along both axes. Vertical sticky bars are handled by CSS
 * scroll-padding (app/globals.css); this only nudges what is still clipped.
 * Large regions (a whole table) are left alone.
 */
export function FocusReveal() {
    useEffect(() => {
        const onFocus = (e: FocusEvent) => {
            const el = e.target;
            if (!(el instanceof HTMLElement) || !el.matches(':focus-visible')) return;
            const r = el.getBoundingClientRect();
            const vw = document.documentElement.clientWidth;
            if (r.width === 0 || r.width > vw * 0.8 || r.height > window.innerHeight * 0.5) return;
            let clipped = r.left < 0 || r.right > vw;
            for (let a = el.parentElement; a && !clipped && a !== document.body; a = a.parentElement) {
                if (a.scrollWidth <= a.clientWidth) continue;
                const ox = getComputedStyle(a).overflowX;
                if (ox !== 'auto' && ox !== 'scroll') continue;
                const box = a.getBoundingClientRect();
                clipped = r.left < box.left || r.right > box.right;
            }
            if (!clipped) return;
            const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
        };
        document.addEventListener('focusin', onFocus);
        return () => document.removeEventListener('focusin', onFocus);
    }, []);
    return null;
}

export default FocusReveal;
