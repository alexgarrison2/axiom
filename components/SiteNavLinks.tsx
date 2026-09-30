'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isActive } from './nav-items';

/** Desktop (md+) section links with aria-current and one brand active style. */
export function SiteNavLinks({ showPlayoffs }: { showPlayoffs: boolean }) {
    const pathname = usePathname();
    const items = NAV_ITEMS.filter(i => !i.playoffsOnly || showPlayoffs || isActive(i.href, pathname));

    return (
        <nav aria-label="Main" className="hidden min-w-0 md:block">
            <ul className="flex items-center gap-1">
                {items.map(item => {
                    const active = isActive(item.href, pathname);
                    return (
                        <li key={item.key}>
                            <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'relative flex h-11 items-center rounded-control px-3 text-body-sm font-semibold transition-colors',
                                    active ? 'text-fg-1' : 'text-fg-2 hover:bg-surface-1 hover:text-fg-1',
                                    item.playoffsOnly && !active && 'text-playoff',
                                )}
                            >
                                {item.label}
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'absolute inset-x-3 -bottom-2 h-0.5 rounded-full transition-opacity',
                                        active ? 'bg-brand opacity-100 shadow-[0_0_10px_rgb(var(--brand-rgb)/0.8)]' : 'opacity-0',
                                    )}
                                />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

export default SiteNavLinks;
