'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_TEAMS, DIVISIONS, DIVISION_LABEL } from '@/utils/team-stats/teams';

interface TeamSelectorProps {
    /** Tricode of the team being viewed. */
    current: string;
    className?: string;
}

/**
 * Team switcher: a Radix popover (aria-expanded on the trigger, Esc closes and
 * returns focus). On phones the panel is the viewport width minus 12px a side
 * and collision padding keeps it on-screen; the search box is 16px so iOS
 * does not zoom.
 */
export default function TeamSelector({ current, className }: TeamSelectorProps) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState('');
    const [suffix, setSuffix] = React.useState('');
    const cur = ALL_TEAMS.find(t => t.tri === current);

    const onOpenChange = (o: boolean) => {
        setOpen(o);
        if (o) {
            setQ('');
            try {
                const tab = new URLSearchParams(window.location.search).get('tab');
                setSuffix(tab ? `?tab=${encodeURIComponent(tab)}` : '');
            } catch {
                setSuffix('');
            }
        }
    };

    const query = q.trim().toLowerCase();
    const matches = (t: (typeof ALL_TEAMS)[number]) =>
        !query || t.name.toLowerCase().includes(query) || t.common.toLowerCase().includes(query) || t.tri.toLowerCase().includes(query);

    return (
        <Popover.Root open={open} onOpenChange={onOpenChange}>
            <Popover.Trigger
                className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line bg-surface-1 px-2.5 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 coarse:min-h-11',
                    className,
                )}
                aria-label={`Switch team (current: ${cur?.name ?? current})`}
            >
                <Image src={`/logos/${current}.svg`} alt="" width={20} height={20} unoptimized className="h-5 w-5 object-contain" />
                <span>Switch team</span>
                <ChevronDown aria-hidden="true" className={cn('h-4 w-4 text-fg-2 transition-transform', open && 'rotate-180')} />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    aria-label="Choose a team"
                    onOpenAutoFocus={e => {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input')?.focus();
                    }}
                    className={cn(
                        'z-[70] flex flex-col overflow-hidden rounded-card border border-line-strong bg-surface-1 shadow-card animate-pop-in focus:outline-none',
                        // phones: full width minus 12px each side (collisionPadding keeps it on-screen)
                        'w-[calc(100vw-24px)] max-h-[min(calc(100dvh-6rem),var(--radix-popover-content-available-height))]',
                        'md:w-[720px] md:max-h-[min(80vh,640px,var(--radix-popover-content-available-height))]',
                    )}
                >
                    <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-3" />
                        <input
                            type="search"
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            placeholder="Search teams"
                            aria-label="Search teams"
                            className="min-h-11 w-full bg-transparent text-base text-fg-1 outline-none placeholder:text-fg-3"
                        />
                        <Popover.Close className="inline-flex h-9 min-w-9 items-center justify-center rounded-control text-body-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg-1 coarse:h-11 coarse:min-w-11">
                            Close
                        </Popover.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                            {DIVISIONS.map(div => {
                                const teams = ALL_TEAMS.filter(t => t.division === div && matches(t)).sort((a, b) => a.common.localeCompare(b.common));
                                if (!teams.length) return null;
                                return (
                                    <div key={div}>
                                        <p className="hud-label mb-1 px-2">{DIVISION_LABEL[div]}</p>
                                        <ul>
                                            {teams.map(t => (
                                                <li key={t.tri}>
                                                    <Link
                                                        href={`/teams/${t.tri}${suffix}`}
                                                        onClick={() => setOpen(false)}
                                                        aria-current={t.tri === current ? 'page' : undefined}
                                                        className={cn(
                                                            'flex min-h-10 items-center gap-2 rounded-control px-2 text-body-sm transition-colors hover:bg-surface-2 coarse:min-h-11',
                                                            t.tri === current ? 'bg-surface-3 font-semibold text-fg-1 shadow-[inset_0_0_0_1px_rgb(var(--brand-rgb))]' : 'text-fg-2 hover:text-fg-1',
                                                        )}
                                                    >
                                                        <Image src={`/logos/${t.tri}.svg`} alt="" width={22} height={22} unoptimized className="h-5 w-5 object-contain" />
                                                        {t.common}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                        {ALL_TEAMS.every(t => !matches(t)) ? <p className="px-2 py-6 text-center text-body-sm text-fg-2">No team matches “{q}”.</p> : null}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
