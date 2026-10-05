'use client';

import * as React from 'react';

/**
 * Pins the app bar, sticky filter bars and the bottom tab bar to what is
 * actually on screen on iOS 26.
 *
 * iOS 26 WebKit can leave the visual viewport offset from the layout viewport
 * after the keyboard or a native picker closes (`visualViewport.offsetTop`
 * stays > 0; WebKit bug 297779, FB19889436). Sticky and fixed elements stay
 * anchored to the layout viewport, so the header slides off the top and the
 * tab bar floats mid-screen, on every page until the app is relaunched.
 *
 * A hidden `position: fixed; inset: 0` probe measures where fixed elements
 * are laid out; the difference to the visual viewport is published as two CSS
 * variables, used as offsets by the pinned elements:
 *   --vv-top     shift for top-anchored elements (px, positive = down)
 *   --vv-bottom  shift for bottom-anchored elements (px, positive = down)
 * Both are 0 whenever the two viewports agree, i.e. everywhere but the bug.
 * While a text field is focused (keyboard up) or the page is pinch-zoomed the
 * native behaviour is left alone.
 */

export interface Box {
    top: number;
    bottom: number;
}

/** Shifts that move elements laid out in `fixedBox` onto `visual` (both in client coordinates). */
export function viewportShift(fixedBox: Box, visual: Box): { top: number; bottom: number } {
    const round = (v: number) => (Math.abs(v) < 1 ? 0 : Math.round(v));
    return { top: round(visual.top - fixedBox.top), bottom: round(visual.bottom - fixedBox.bottom) };
}

const editing = (el: Element | null) =>
    !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(el.type)) || (el as HTMLElement).isContentEditable);

export function ViewportAnchor() {
    const probe = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const vv = window.visualViewport;
        const el = probe.current;
        if (!vv || !el) return;
        const root = document.documentElement;
        let frame = 0;
        let last = '';
        const timers: number[] = [];

        const apply = () => {
            frame = 0;
            let top = 0;
            let bottom = 0;
            if (!editing(document.activeElement) && Math.abs(vv.scale - 1) < 0.01) {
                const r = el.getBoundingClientRect();
                const s = viewportShift({ top: r.top, bottom: r.bottom }, { top: vv.offsetTop, bottom: vv.offsetTop + vv.height });
                top = s.top;
                bottom = s.bottom;
            }
            const next = `${top},${bottom}`;
            if (next === last) return;
            last = next;
            root.style.setProperty('--vv-top', `${top}px`);
            root.style.setProperty('--vv-bottom', `${bottom}px`);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(apply);
        };
        // WebKit publishes viewport values late after the keyboard closes: re-check a few times.
        const settle = () => {
            schedule();
            timers.splice(0).forEach(clearTimeout);
            for (const ms of [50, 150, 300, 600]) timers.push(window.setTimeout(schedule, ms));
        };

        vv.addEventListener('resize', settle);
        vv.addEventListener('scroll', schedule);
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('focusin', settle);
        window.addEventListener('focusout', settle);
        window.addEventListener('pageshow', settle);
        window.addEventListener('orientationchange', settle);
        document.addEventListener('visibilitychange', settle);
        settle();
        return () => {
            cancelAnimationFrame(frame);
            timers.forEach(clearTimeout);
            vv.removeEventListener('resize', settle);
            vv.removeEventListener('scroll', schedule);
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('focusin', settle);
            window.removeEventListener('focusout', settle);
            window.removeEventListener('pageshow', settle);
            window.removeEventListener('orientationchange', settle);
            document.removeEventListener('visibilitychange', settle);
            root.style.removeProperty('--vv-top');
            root.style.removeProperty('--vv-bottom');
        };
    }, []);

    return <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed inset-0 -z-10" />;
}

export default ViewportAnchor;
