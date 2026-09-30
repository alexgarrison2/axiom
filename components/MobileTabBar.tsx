'use client';

import * as React from 'react';
import { IntentLink } from './IntentLink';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BookOpen, Ellipsis, ListOrdered, Newspaper, Shield, Target, Trophy, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogClose } from '@/components/ui/dialog';
import { NAV_ITEMS, isActive, isItemActive, playoffsLink, type NavItem } from './nav-items';

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
 * More) in the nav's language: mono uppercase labels, cyan active edge.
 * Respects the home-indicator safe area. "More" opens a bottom sheet with
 * the remaining sections.
 */
export function MobileTabBar({ playoffsSeason }: { playoffsSeason?: string | null }) {
    const pathname = usePathname();
    const [moreOpen, setMoreOpen] = React.useState(false);
    const primary = NAV_ITEMS.filter(i => i.primary);
    const secondary = NAV_ITEMS.filter(i => !i.primary);
    const archive = playoffsLink(playoffsSeason);
    // Standings, Playoffs 25-26, News, How it works
    const more: NavItem[] = archive ? [secondary[0], archive, ...secondary.slice(1)] : secondary;
    const moreActive = more.some(i => isItemActive(i, pathname));

    const tabClass = (active: boolean) =>
        cn(
            'relative flex h-full min-h-11 flex-1 flex-col items-center justify-center gap-1 text-micro font-medium uppercase tracking-[0.08em] transition-colors',
            active ? 'text-brand' : 'text-fg-3 active:text-fg-1',
        );

    return (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/[.92] pb-[env(safe-area-inset-bottom)] backdrop-blur-[10px] md:hidden">
            <ul className="flex h-tabbar items-stretch">
                {primary.map(item => {
                    const Icon = ICONS[item.key];
                    const active = isItemActive(item, pathname);
                    return (
                        <li key={item.key} className="flex flex-1">
                            <IntentLink href={item.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
                                <span aria-hidden="true" className={cn('absolute inset-x-4 -top-px h-0.5', active ? 'bg-brand shadow-[0_0_10px_rgb(var(--brand-rgb))]' : 'bg-transparent')} />
                                <Icon aria-hidden="true" strokeWidth={1.75} className="h-[18px] w-[18px]" />
                                <span>{item.short ?? item.label}</span>
                            </IntentLink>
                        </li>
                    );
                })}
                <li className="flex flex-1">
                    <DialogPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
                        <DialogPrimitive.Trigger className={tabClass(moreActive)} aria-label={moreActive ? 'More sections (current section is here)' : 'More sections'}>
                            <span aria-hidden="true" className={cn('absolute inset-x-4 -top-px h-0.5', moreActive ? 'bg-brand shadow-[0_0_10px_rgb(var(--brand-rgb))]' : 'bg-transparent')} />
                            <Ellipsis aria-hidden="true" strokeWidth={1.75} className="h-[18px] w-[18px]" />
                            <span aria-hidden="true">More</span>
                        </DialogPrimitive.Trigger>
                        <DialogPrimitive.Portal>
                            <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-bg/70 backdrop-blur-sm animate-fade-in md:hidden" />
                            <DialogPrimitive.Content
                                aria-describedby={undefined}
                                className="fixed inset-x-0 bottom-0 z-[61] rounded-t-card border-t border-line-strong bg-surface-1 pb-[calc(env(safe-area-inset-bottom)+8px)] animate-sheet-up focus:outline-none md:hidden"
                            >
                                <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-mute" />
                                <div className="flex items-center justify-between px-card pb-1 pt-1">
                                    <DialogPrimitive.Title className="label">More</DialogPrimitive.Title>
                                    <DialogClose label="Close menu" />
                                </div>
                                <ul className="px-2">
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
                                                        'flex min-h-12 items-center gap-3 rounded-control px-3 text-caption font-medium uppercase tracking-label transition-colors',
                                                        active ? 'text-brand' : 'text-fg-1 hover:text-brand',
                                                    )}
                                                >
                                                    <Icon aria-hidden="true" strokeWidth={1.75} className={cn('h-[18px] w-[18px]', !active && 'text-fg-3')} />
                                                    <span>{item.label}</span>
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
