'use client';

import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isItemActive } from './nav-items';

/** Desktop (md+) section links: mono uppercase, cyan underline on the active one. */
export function SiteNavLinks() {
    const pathname = usePathname();

    return (
        // Scrolls sideways rather than running into the freshness badge at
        // tablet widths; p-1 keeps focus rings unclipped.
        <nav aria-label="Main" className="hidden min-w-0 overflow-x-auto scrollbar-hide md:block">
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
