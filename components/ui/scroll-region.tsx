'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ScrollRegionProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Accessible name, e.g. "Standings table". Required: the region is focusable. */
    label: string;
    /** Scroll axis (default horizontal). */
    axis?: 'x' | 'y' | 'both';
}

/**
 * A keyboard-reachable scroll container (tabIndex=0, role=region, aria-label)
 * with edge fades that appear only where more content is hidden.
 */
export const ScrollRegion = React.forwardRef<HTMLDivElement, ScrollRegionProps>(function ScrollRegion(
    { label, axis = 'x', className, children, onScroll, ...rest },
    forwardedRef,
) {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [edges, setEdges] = React.useState({ start: false, end: false });

    const update = React.useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const start = el.scrollLeft > 4;
        const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setEdges(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
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

    const fade = axis === 'y' ? '' : edges.start && edges.end ? 'edge-fade-x' : edges.end ? 'edge-fade-right' : edges.start ? 'edge-fade-left' : '';

    return (
        <div
            ref={el => {
                ref.current = el;
                if (typeof forwardedRef === 'function') forwardedRef(el);
                else if (forwardedRef) forwardedRef.current = el;
            }}
            role="region"
            aria-label={label}
            tabIndex={0}
            onScroll={e => {
                update();
                onScroll?.(e);
            }}
            className={cn(
                axis === 'x' && 'overflow-x-auto overflow-y-hidden',
                axis === 'y' && 'overflow-y-auto',
                axis === 'both' && 'overflow-auto',
                'overscroll-x-contain',
                fade,
                className,
            )}
            {...rest}
        >
            {children}
        </div>
    );
});

export default ScrollRegion;
