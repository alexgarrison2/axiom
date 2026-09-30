'use client';

import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isActive } from './nav-items';

/** Desktop (md+) section links: mono uppercase, cyan underline on the active one. */
export function SiteNavLinks({ showPlayoffs }: { showPlayoffs: boolean }) {
    const pathname = usePathname();
    const items = NAV_ITEMS.filter(i => !i.playoffsOnly || showPlayoffs || isActive(i.href, pathname));

    return (
        <nav aria-label="Main" className="hidden min-w-0 md:block">
            <ul className="flex items-center gap-5 lg:gap-7">
                {items.map(item => {
                    const active = isActive(item.href, pathname);
                    return (
                        <li key={item.key}>
                            <IntentLink
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'relative flex h-11 items-center whitespace-nowrap text-caption font-medium uppercase tracking-label transition-colors',
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
