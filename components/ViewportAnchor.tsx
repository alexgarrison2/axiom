'use client';

import * as React from 'react';

/**
 * Pins the app bar, sticky filter bars and the bottom tab bar to what is
 * actually on screen after iOS 26 strands the visual viewport.
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
 *
 * The probe and the visual viewport also disagree, legitimately and briefly,
 * during ordinary browsing: rubber-band overscroll at the top shrinks
 * `visualViewport.height` by the pull distance, overscroll at the bottom moves
 * the probe up and grows `offsetTop` by as much, and the visual viewport keeps
 * the keyboard-up height for a moment after the keyboard closes. Correcting those moved the bars all over the
 * screen while dragging. So the anchor is a no-op unless all of this holds:
 *   - it is armed: on mount, when a field loses focus (keyboard or native
 *     picker closed), when the page is restored or shown again, or when the
 *     orientation changes; it disarms at the first idle sample, at least
 *     ARMED_MS after arming, in which the viewports agree;
 *   - the page is idle: no finger down and no scroll / viewport event for a
 *     moment, so nothing is updated mid-scroll or during a bounce;
 *   - the sample is trustworthy (`trustedShift`): not editing, not zoomed,
 *     scroll position inside [0, max] and the visual viewport not shorter
 *     than the fixed layout box;
 *   - the same offset is measured twice in a row while idle.
 * Once applied, the shift is held while scrolling and re-checked when the page
 * comes to rest; it drops back to 0 as soon as the viewports agree.
 */

export interface Box {
    top: number;
    bottom: number;
}

export interface Shift {
    top: number;
    bottom: number;
}

/** Shifts that move elements laid out in `fixedBox` onto `visual` (both in client coordinates). */
export function viewportShift(fixedBox: Box, visual: Box): Shift {
    const round = (v: number) => (Math.abs(v) < 1 ? 0 : Math.round(v));
    return { top: round(visual.top - fixedBox.top), bottom: round(visual.bottom - fixedBox.bottom) };
}

export interface ViewportSample {
    /** Where `position: fixed; inset: 0` is laid out (client coordinates). */
    fixed: Box;
    /** The visual viewport: `offsetTop` to `offsetTop + height`. */
    visual: Box;
    scrollY: number;
    /** `scrollHeight - innerHeight`. */
    maxScroll: number;
    /** `visualViewport.scale`. */
    scale: number;
    /** A text field has focus (keyboard up). */
    editing: boolean;
}

/**
 * The shift for a sample taken while the page is at rest, or null when the
 * sample says nothing about the WebKit bug and must not move the bars:
 * editing or zoomed (native behaviour), rubber-banding past either end, or a
 * visual viewport shorter than the fixed box (top overscroll, or the keyboard
 * still on its way out). The bug only ever leaves the visual viewport offset
 * or taller than the box fixed elements use.
 */
export function trustedShift(s: ViewportSample): Shift | null {
    if (s.editing || Math.abs(s.scale - 1) >= 0.01) return null;
    if (s.scrollY < -1 || s.scrollY > Math.max(0, s.maxScroll) + 1) return null;
    if (s.visual.bottom - s.visual.top < s.fixed.bottom - s.fixed.top - 1) return null;
    return viewportShift(s.fixed, s.visual);
}

const editing = (el: Element | null) =>
    !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(el.type)) || (el as HTMLElement).isContentEditable);

/** No scroll or viewport event for this long counts as idle. */
const QUIET_MS = 200;
/** Two equal samples at least this far apart count as persistent. */
const CONFIRM_MS = 120;
/** An armed anchor only disarms on a sample taken at least this long after the arming event. */
const ARMED_MS = 1500;
/** Extra checks after arming: WebKit publishes viewport values late after the keyboard closes. */
const SETTLE_MS = [60, 200, 400, 700, 1000, ARMED_MS + 50];

export function ViewportAnchor() {
    const probe = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const vv = window.visualViewport;
        const el = probe.current;
        if (!vv || !el) return;
        const root = document.documentElement;

        let applied = '0,0';
        let armedAt = 0;
        let touching = false;
        let lastMotion = 0;
        let candidate: { key: string; at: number } | null = null;
        let idleTimer = 0;
        const settleTimers: number[] = [];

        const engaged = () => applied !== '0,0';
        const active = () => engaged() || armedAt > 0;

        const write = (top: number, bottom: number) => {
            const next = `${top},${bottom}`;
            if (next === applied) return;
            applied = next;
            root.style.setProperty('--vv-top', `${top}px`);
            root.style.setProperty('--vv-bottom', `${bottom}px`);
        };

        const later = (ms: number) => {
            clearTimeout(idleTimer);
            idleTimer = window.setTimeout(check, ms);
        };

        const check = () => {
            if (!active()) {
                candidate = null;
                return;
            }
            const now = performance.now();
            const quiet = now - lastMotion;
            // Never mid-gesture or mid-scroll: touchend / the last scroll event re-checks.
            if (touching) return;
            if (quiet < QUIET_MS) return later(QUIET_MS - quiet + 10);

            const r = el.getBoundingClientRect();
            const sample: ViewportSample = {
                fixed: { top: r.top, bottom: r.bottom },
                visual: { top: vv.offsetTop, bottom: vv.offsetTop + vv.height },
                scrollY: window.scrollY,
                maxScroll: root.scrollHeight - window.innerHeight,
                scale: vv.scale,
                editing: editing(document.activeElement),
            };
            if (sample.editing || Math.abs(sample.scale - 1) >= 0.01) {
                // Keyboard up or pinch-zoomed: leave the native behaviour alone.
                candidate = null;
                return write(0, 0);
            }
            const s = trustedShift(sample);
            if (!s) {
                // Overscroll or a viewport still animating: hold whatever is applied.
                candidate = null;
                return;
            }
            if (s.top === 0 && s.bottom === 0) {
                candidate = null;
                write(0, 0);
                if (now - armedAt >= ARMED_MS) armedAt = 0;
                return;
            }
            const key = `${s.top},${s.bottom}`;
            if (key === applied) {
                candidate = null;
                return;
            }
            if (candidate?.key === key && now - candidate.at >= CONFIRM_MS) {
                candidate = null;
                return write(s.top, s.bottom);
            }
            if (candidate?.key !== key) candidate = { key, at: now };
            later(CONFIRM_MS + 10);
        };

        /** Scrolling, bouncing or a viewport change: postpone any check until the page is at rest. */
        const motion = () => {
            lastMotion = performance.now();
            candidate = null;
            if (active()) later(QUIET_MS + 10);
        };
        const arm = () => {
            armedAt = performance.now();
            settleTimers.splice(0).forEach(clearTimeout);
            for (const ms of SETTLE_MS) settleTimers.push(window.setTimeout(check, ms));
        };
        const onTouchStart = () => {
            touching = true;
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length) return;
            touching = false;
            motion();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') arm();
        };

        vv.addEventListener('resize', motion);
        vv.addEventListener('scroll', motion);
        window.addEventListener('scroll', motion, { passive: true });
        window.addEventListener('touchstart', onTouchStart, { passive: true });
        window.addEventListener('touchend', onTouchEnd, { passive: true });
        window.addEventListener('touchcancel', onTouchEnd, { passive: true });
        window.addEventListener('focusout', arm);
        window.addEventListener('pageshow', arm);
        window.addEventListener('orientationchange', arm);
        document.addEventListener('visibilitychange', onVisibility);
        arm();
        return () => {
            clearTimeout(idleTimer);
            settleTimers.forEach(clearTimeout);
            vv.removeEventListener('resize', motion);
            vv.removeEventListener('scroll', motion);
            window.removeEventListener('scroll', motion);
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', onTouchEnd);
            window.removeEventListener('focusout', arm);
            window.removeEventListener('pageshow', arm);
            window.removeEventListener('orientationchange', arm);
            document.removeEventListener('visibilitychange', onVisibility);
            root.style.removeProperty('--vv-top');
            root.style.removeProperty('--vv-bottom');
        };
    }, []);

    return <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed inset-0 -z-10" />;
}

export default ViewportAnchor;
