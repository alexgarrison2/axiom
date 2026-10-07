'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isActive, isItemActive, playoffsLink, type NavItem } from './nav-items';

const linkClass = (active: boolean) =>
    cn(
        'relative flex h-11 items-center whitespace-nowrap text-caption font-medium uppercase tracking-[0.12em] transition-colors lg:tracking-label',
        active ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1',
    );

function Underline({ active }: { active: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={cn('absolute inset-x-0 bottom-1.5 h-0.5 transition-opacity', active ? 'bg-brand opacity-100 shadow-[0_6px_12px_-4px_rgb(var(--brand-rgb))]' : 'opacity-0')}
        />
    );
}

/**
 * Tablet widths (md to lg) have room for the bottom bar's sections only: the rest
 * (Standings, the playoff archive, News, How it works) sit under "More", as on phones.
 */
function TabletMore({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
    const [pos, setPos] = React.useState<{ top: number; right: number } | null>(null);
    const button = React.useRef<HTMLButtonElement>(null);
    const menu = React.useRef<HTMLUListElement>(null);
    const open = pos != null;
    const active = items.some(i => isItemActive(i, pathname));
    const close = React.useCallback((refocus = false) => {
        setPos(null);
        if (refocus) button.current?.focus({ preventScroll: true });
    }, []);

    React.useEffect(() => close(), [pathname, close]);
    React.useEffect(() => {
        if (!open) return;
        menu.current?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close(true);
        };
        const resize = () => close();
        document.addEventListener('keydown', esc);
        window.addEventListener('resize', resize);
        return () => {
            document.removeEventListener('keydown', esc);
            window.removeEventListener('resize', resize);
        };
    }, [open, close]);

    const toggle = () => {
        if (open) return close();
        const r = button.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom, right: Math.max(8, window.innerWidth - r.right) });
    };

    return (
        <li className="relative lg:hidden">
            <button ref={button} type="button" aria-expanded={open} aria-haspopup="true" onClick={toggle} className={linkClass(active)}>
                More
                <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('ml-1 h-3 w-3 transition-transform', open && 'rotate-180')}>
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <Underline active={active} />
            </button>
            {open
                ? createPortal(
                      <>
                          {/* A transparent catcher: the tap that closes the menu goes nowhere else. */}
                          <div aria-hidden="true" className="fixed inset-0 z-[60]" onClick={() => close()} />
                          <ul
                              ref={menu}
                              className="fixed z-[61] min-w-48 rounded-control border border-line-strong bg-surface-1 py-1 shadow-card animate-fade-in"
                              style={{ top: pos.top, right: pos.right }}
                          >
                              {items.map(item => {
                                  const on = isActive(item.href, pathname);
                                  return (
                                      <li key={item.key}>
                                          <IntentLink
                                              href={item.href}
                                              aria-current={on ? 'page' : undefined}
                                              onClick={() => close()}
                                              className={cn(
                                                  'flex min-h-11 items-center px-4 text-caption font-medium uppercase tracking-[0.12em] transition-colors',
                                                  on ? 'text-brand' : 'text-fg-1 hover:text-brand',
                                              )}
                                          >
                                              {item.label}
                                          </IntentLink>
                                      </li>
                                  );
                              })}
                          </ul>
                      </>,
                      document.body,
                  )
                : null}
        </li>
    );
}

/** Desktop (md+) section links: mono uppercase, cyan underline on the active one. */
export function SiteNavLinks({ playoffsSeason }: { playoffsSeason?: string | null }) {
    const pathname = usePathname();
    const secondary = NAV_ITEMS.filter(i => !i.primary);
    const archive = playoffsLink(playoffsSeason);
    // Same order as the phone More sheet: Standings, Playoffs 25-26, News, How it works.
    const more: NavItem[] = archive ? [secondary[0], archive, ...secondary.slice(1)] : secondary;

    return (
        // Scrolls sideways rather than running into the freshness badge at
        // tablet widths; p-1 keeps focus rings unclipped.
        <nav aria-label="Main" className="hidden min-w-0 overflow-x-auto scrollbar-hide md:block md:max-lg:overflow-visible">
            <ul className="flex items-center gap-4 p-1 lg:gap-7">
                {NAV_ITEMS.map(item => {
                    const active = isItemActive(item, pathname);
                    return (
                        // Below lg only the bottom bar's sections show inline; the rest are under More.
                        <li key={item.key} className={item.primary ? undefined : 'md:max-lg:hidden'}>
                            <IntentLink href={item.href} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                                {item.label}
                                <Underline active={active} />
                            </IntentLink>
                        </li>
                    );
                })}
                <TabletMore items={more} pathname={pathname} />
            </ul>
        </nav>
    );
}

export default SiteNavLinks;
