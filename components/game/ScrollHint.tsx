'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Right-edge fade over a sibling table scroller (the `role="region"` next to
 * it) while more columns sit off to the right. The scroller itself has no
 * mask, so its pinned first column stays crisp. Put it inside a `relative`
 * wrapper with the scroller; phones and tablets only.
 */
export function ScrollHint() {
    const ref = React.useRef<HTMLSpanElement>(null);
    const [more, setMore] = React.useState(false);
    React.useEffect(() => {
        const el = ref.current?.parentElement?.querySelector<HTMLElement>('[role="region"]');
        if (!el) return;
        const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        ro?.observe(el);
        if (el.firstElementChild) ro?.observe(el.firstElementChild);
        return () => {
            el.removeEventListener('scroll', update);
            ro?.disconnect();
        };
    }, []);
    return (
        <span
            ref={ref}
            aria-hidden="true"
            className={cn('pointer-events-none absolute inset-y-0 right-0 z-[5] w-8 bg-gradient-to-l from-surface-1 to-transparent transition-opacity lg:hidden', more ? 'opacity-100' : 'opacity-0')}
        />
    );
}
