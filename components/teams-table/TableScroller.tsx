'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { SCROLLER } from './table-style';

/**
 * Keyboard-reachable two-axis scroll container for a sticky-header table
 * (role=region, tabIndex=0, aria-label). Unlike ScrollRegion it never fades
 * the left edge (that would also fade the pinned first column); below lg the
 * right edge fades while more columns sit off-screen, as the swipe hint.
 */
export function TableScroller({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [more, setMore] = React.useState(false);

    const update = React.useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setMore(prev => (prev === next ? prev : next));
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
        <div ref={ref} role="region" aria-label={label} tabIndex={0} onScroll={update} className={cn(SCROLLER, more && 'max-lg:edge-fade-right', className)}>
            {children}
        </div>
    );
}
