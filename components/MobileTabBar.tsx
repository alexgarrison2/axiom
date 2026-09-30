'use client';

import * as React from 'react';
import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BookOpen, Ellipsis, ListOrdered, Newspaper, Shield, Target, Trophy, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogClose } from '@/components/ui/dialog';
import { EXTRA_LINKS, NAV_ITEMS, isActive } from './nav-items';

/** Rink-and-puck glyph for "Tonight". */
function RinkIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="2.5" y="5" width="19" height="14" rx="6" />
            <path d="M12 5v14" />
            <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </svg>
    );
}

const ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
    tonight: RinkIcon,
    teams: Shield,
    players: Users,
    accuracy: Target,
    standings: ListOrdered,
    news: Newspaper,
    playoffs: Trophy,
    methodology: BookOpen,
};

/**
 * Below md: a fixed 56px bottom tab bar (Tonight, Teams, Players, Accuracy,
 * More) that respects the home-indicator safe area. "More" opens a bottom
 * sheet with the remaining sections.
 */
export function MobileTabBar({ showPlayoffs }: { showPlayoffs: boolean }) {
    const pathname = usePathname();
    const [moreOpen, setMoreOpen] = React.useState(false);
    const primary = NAV_ITEMS.filter(i => i.primary);
    const more = [...NAV_ITEMS.filter(i => !i.primary && (!i.playoffsOnly || showPlayoffs)), ...EXTRA_LINKS];
    const moreActive = more.some(i => isActive(i.href, pathname));

    const tabClass = (active: boolean) =>
        cn(
            'relative flex h-full min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-micro font-semibold tracking-normal transition-colors',
            active ? 'text-brand' : 'text-fg-2 active:text-fg-1',
        );

    return (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
            <ul className="flex h-tabbar items-stretch">
                {primary.map(item => {
                    const Icon = ICONS[item.key];
                    const active = isActive(item.href, pathname);
                    return (
                        <li key={item.key} className="flex flex-1">
                            <IntentLink href={item.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
                                <span aria-hidden="true" className={cn('absolute inset-x-5 top-0 h-0.5 rounded-b-full', active ? 'bg-brand' : 'bg-transparent')} />
                                <Icon aria-hidden="true" className="h-5 w-5" />
                                <span>{item.short ?? item.label}</span>
                            </IntentLink>
                        </li>
                    );
                })}
                <li className="flex flex-1">
                    <DialogPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
                        <DialogPrimitive.Trigger className={tabClass(moreActive)} aria-label={moreActive ? 'More sections (current section is here)' : 'More sections'}>
                            <span aria-hidden="true" className={cn('absolute inset-x-5 top-0 h-0.5 rounded-b-full', moreActive ? 'bg-brand' : 'bg-transparent')} />
                            <Ellipsis aria-hidden="true" className="h-5 w-5" />
                            <span aria-hidden="true">More</span>
                        </DialogPrimitive.Trigger>
                        <DialogPrimitive.Portal>
                            <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-bg/70 backdrop-blur-sm animate-fade-in md:hidden" />
                            <DialogPrimitive.Content
                                aria-describedby={undefined}
                                className="fixed inset-x-0 bottom-0 z-[61] rounded-t-card border-t border-line-strong bg-surface-1 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-card animate-sheet-up focus:outline-none md:hidden"
                            >
                                <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-fg-3/40" />
                                <div className="flex items-center justify-between px-5 pb-1 pt-2">
                                    <DialogPrimitive.Title className="text-title font-bold text-fg-1">More</DialogPrimitive.Title>
                                    <DialogClose label="Close menu" />
                                </div>
                                <ul className="px-3">
                                    {more.map(item => {
                                        const Icon = ICONS[item.key] ?? BookOpen;
                                        const active = isActive(item.href, pathname);
                                        return (
                                            <li key={item.key}>
                                                <IntentLink
                                                    href={item.href}
                                                    aria-current={active ? 'page' : undefined}
                                                    onClick={() => setMoreOpen(false)}
                                                    className={cn(
                                                        'flex min-h-14 items-center gap-3 rounded-control px-2 transition-colors hover:bg-surface-2',
                                                        active && 'bg-surface-2',
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line',
                                                            active ? 'text-brand' : item.key === 'playoffs' ? 'text-playoff' : 'text-fg-2',
                                                        )}
                                                    >
                                                        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className={cn('block text-body font-semibold', active ? 'text-brand' : 'text-fg-1')}>{item.label}</span>
                                                        <span className="block truncate text-caption text-fg-3">{item.description}</span>
                                                    </span>
                                                </IntentLink>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </DialogPrimitive.Content>
                        </DialogPrimitive.Portal>
                    </DialogPrimitive.Root>
                </li>
            </ul>
        </nav>
    );
}

export default MobileTabBar;
