'use client';

import * as React from 'react';

/*
 * Years under a trophy as unbreakable items, centred and wrapping. Each item
 * owns the "·" before it, drawn in the gap; the item that starts a line hides
 * its dot (measured after layout and on resize), so no line starts or ends
 * with a separator.
 */
export function YearList({ years }: { years: string[] }) {
    const ref = React.useRef<HTMLParagraphElement>(null);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const mark = () => {
            let top = Number.NaN;
            for (const c of Array.from(el.children) as HTMLElement[]) {
                const t = c.offsetTop;
                c.dataset.lead = t !== top ? '1' : '0';
                top = t;
            }
        };
        mark();
        const ro = new ResizeObserver(mark);
        ro.observe(el);
        return () => ro.disconnect();
    }, [years]);
    return (
        <p ref={ref} className="mt-0.5 flex flex-wrap justify-center gap-x-[0.9em] text-micro tabular-nums text-fg-3">
            {years.map((y, i) => (
                <span
                    key={y}
                    data-lead={i ? '0' : '1'}
                    className="relative whitespace-nowrap before:absolute before:right-full before:w-[0.9em] before:text-center before:content-['·'] data-[lead='1']:before:invisible"
                >
                    {y}
                </span>
            ))}
        </p>
    );
}
