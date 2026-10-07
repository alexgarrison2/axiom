'use client';

import * as React from 'react';

/** Content box of an element, tracked with ResizeObserver (0 until measured). */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
    const ref = React.useRef<T>(null);
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const read = () => {
            const next = { w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) };
            setSize(prev => (prev.w === next.w && prev.h === next.h ? prev : next));
        };
        read();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, size];
}

/** Content width of an element (0 until measured). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const [ref, size] = useSize<T>();
    return [ref, size.w];
}
