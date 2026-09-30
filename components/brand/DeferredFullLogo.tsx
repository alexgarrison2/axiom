'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const FullLogoAnimated = dynamic(() => import('@/components/FullLogoAnimated'), { ssr: false });

/**
 * The full animated logo as a decorative hero, loaded after hydration and
 * only where it is shown (md and up). Inlined in the server HTML it cost
 * ~38 KB twice (HTML + RSC payload) and pushed /methodology over its 60 KB
 * gzip HTML budget. The box reserves the logo's 573:174 aspect ratio, so
 * nothing shifts when it appears.
 */
export function DeferredFullLogo({ idPrefix, minWidth = 768 }: { idPrefix: string; minWidth?: number }) {
    const [show, setShow] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
        const on = () => setShow(mq.matches);
        on();
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, [minWidth]);
    return <div className="aspect-[573/174] w-full">{show ? <FullLogoAnimated idPrefix={idPrefix} /> : null}</div>;
}

export default DeferredFullLogo;
