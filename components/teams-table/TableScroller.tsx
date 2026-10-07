'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { SCROLLER } from './table-style';

interface TableScrollerProps {
    label: string;
    className?: string;
    children: React.ReactNode;
    /** Below lg the page scrolls the rows (no box-in-a-page); the caller pins a copy of the header (StickyHead). */
    pageScroll?: boolean;
    /** Horizontal scroll position and whether more columns sit off to the right, for a pinned header copy. */
    onScrollX?: (left: number, more: boolean) => void;
    /** Draw the right-edge swipe hint here (default) or leave it to the caller. */
    fade?: boolean;
}

/**
 * Keyboard-reachable two-axis scroll container for a sticky-header table
 * (role=region, tabIndex=0, aria-label). Unlike ScrollRegion it never fades
 * the left edge (that would also fade the pinned first column); below lg the
 * right edge fades while more columns are off-screen, as the swipe hint.
 * On short viewports (landscape phones) it is never a vertical scroller of
 * its own: the page scrolls, so a swipe over the table always moves the page.
 */
export function TableScroller({ label, className, children, pageScroll, onScrollX, fade = true }: TableScrollerProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [more, setMore] = React.useState(false);
    const cb = React.useRef(onScrollX);
    React.useLayoutEffect(() => {
        cb.current = onScrollX;
    });

    const update = React.useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setMore(prev => (prev === next ? prev : next));
        cb.current?.(el.scrollLeft, next);
    }, []);

    React.useEffect(() => {
        update();
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => ro.disconnect();
    }, [update]);

    return (
        <div
            ref={ref}
            role="region"
            aria-label={label}
            tabIndex={0}
            onScroll={update}
            className={cn(SCROLLER, '[@media(max-height:500px)]:!max-h-none', pageScroll && 'max-lg:!max-h-none', fade && more && 'max-lg:edge-fade-right', className)}
        >
            {children}
        </div>
    );
}

/**
 * The header rows of a page-scrolled table, pinned under the app bar below lg
 * (and on short viewports), kept in line with the table's horizontal scroll.
 * Render it right above the TableScroller inside the same box; the table's
 * own <thead> is hidden at those sizes (PINNED_HEAD_HIDE).
 */
export const StickyHead = React.forwardRef<HTMLDivElement, { className?: string; children: React.ReactNode }>(function StickyHead({ className, children }, ref) {
    return (
        <div
            ref={ref}
            className={cn(
                'sticky top-[calc(var(--appbar-h)+var(--vv-top,0px))] z-[6] hidden overflow-hidden max-lg:block [@media(max-height:500px)]:block',
                className,
            )}
        >
            {children}
        </div>
    );
});

/** On the table's own <thead> when a StickyHead copy takes its place. */
export const PINNED_HEAD_HIDE = 'max-lg:hidden [@media(max-height:500px)]:hidden';
