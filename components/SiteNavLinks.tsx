'use client';

import * as React from 'react';
import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isItemActive } from './nav-items';

function fade({ left, right }: { left: boolean; right: boolean }): React.CSSProperties | undefined {
    if (!left && !right) return undefined;
    const mask = `linear-gradient(to right, ${left ? 'transparent' : '#000'} 0, #000 32px, #000 calc(100% - 32px), ${right ? 'transparent' : '#000'} 100%)`;
    return { WebkitMaskImage: mask, maskImage: mask };
}

/** Desktop (md+) section links: mono uppercase, cyan underline on the active one. */
export function SiteNavLinks() {
    const pathname = usePathname();
    const ref = React.useRef<HTMLElement>(null);
    // Tablet widths: the links overflow; fade whichever edge has links past it.
    const [edges, setEdges] = React.useState({ left: false, right: false });

    React.useEffect(() => {
        const nav = ref.current;
        if (!nav) return;
        const check = () => {
            const left = nav.scrollLeft > 1;
            const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
            setEdges(e => (e.left === left && e.right === right ? e : { left, right }));
        };
        // The active section is scrolled into view (sideways only) when it sits past the edge.
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (active && nav.scrollWidth > nav.clientWidth) {
            const n = nav.getBoundingClientRect();
            const a = active.getBoundingClientRect();
            if (a.right > n.right) nav.scrollLeft += a.right - n.right + 24;
        }
        check();
        nav.addEventListener('scroll', check, { passive: true });
        window.addEventListener('resize', check);
        return () => {
            nav.removeEventListener('scroll', check);
            window.removeEventListener('resize', check);
        };
    }, [pathname]);

    return (
        // Scrolls sideways rather than running into the freshness badge at
        // tablet widths; p-1 keeps focus rings unclipped.
        <nav ref={ref} aria-label="Main" className="hidden min-w-0 overflow-x-auto scrollbar-hide md:block" style={fade(edges)}>
            <ul className="flex items-center gap-4 p-1 lg:gap-7">
                {NAV_ITEMS.map(item => {
                    const active = isItemActive(item, pathname);
                    return (
                        <li key={item.key}>
                            <IntentLink
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'relative flex h-11 items-center whitespace-nowrap text-caption font-medium uppercase tracking-[0.12em] transition-colors lg:tracking-label',
                                    active ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1',
                                )}
                            >
                                {item.label}
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'absolute inset-x-0 bottom-1.5 h-0.5 transition-opacity',
                                        active ? 'bg-brand opacity-100 shadow-[0_6px_12px_-4px_rgb(var(--brand-rgb))]' : 'opacity-0',
                                    )}
                                />
                            </IntentLink>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

export default SiteNavLinks;
