/**
 * Reduced-motion-aware scrolling. An explicit `behavior: 'smooth'` in JS
 * overrides the CSS `scroll-behavior: auto` that globals.css sets under
 * prefers-reduced-motion, so JS scrolls go through here instead.
 */
export function prefersReducedMotion(): boolean {
    try {
        return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** 'smooth' unless the viewer asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
    return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** Element.scrollIntoView with smooth motion only when allowed. */
export function scrollIntoViewSafe(el: Element | null | undefined, opts: Omit<ScrollIntoViewOptions, 'behavior'> = {}): void {
    el?.scrollIntoView({ ...opts, behavior: scrollBehavior() });
}
