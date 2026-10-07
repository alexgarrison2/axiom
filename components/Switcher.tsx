'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SwitcherProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The trigger's accessible name. */
    triggerLabel: string;
    /** Extra trigger handlers (e.g. prefetch on hover / focus). */
    triggerProps?: Pick<React.ComponentPropsWithoutRef<typeof Popover.Trigger>, 'onPointerEnter' | 'onFocus' | 'onPointerDown'>;
    className?: string;
    /** The panel's accessible name. */
    panelLabel: string;
    /** Width and height from md up (phones: the viewport less 12px a side). */
    panelClassName?: string;
    /** Keys anywhere in the panel (list navigation). */
    onPanelKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    query: string;
    onQuery: (q: string) => void;
    searchLabel: string;
    /** Extra input attributes (combobox roles, key handling). */
    inputProps?: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;
    bodyClassName?: string;
    children: React.ReactNode;
}

/**
 * The "SWITCH" pill and its search panel (team and player pages): a Radix
 * popover (aria-expanded on the trigger, Esc closes and returns focus). On
 * phones the panel is the viewport width minus 12px a side and collision
 * padding keeps it on-screen; the search box is 16px so iOS does not zoom,
 * and on touch the panel takes focus so no keyboard covers the list until
 * the search box is tapped. The list scrolls inside without chaining.
 */
export function Switcher({
    open,
    onOpenChange,
    triggerLabel,
    triggerProps,
    className,
    panelLabel,
    panelClassName,
    onPanelKeyDown,
    query,
    onQuery,
    searchLabel,
    inputProps,
    bodyClassName,
    children,
}: SwitcherProps) {
    return (
        <Popover.Root open={open} onOpenChange={onOpenChange}>
            <Popover.Trigger
                {...triggerProps}
                className={cn(
                    'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line px-3 text-micro font-medium uppercase tracking-chip text-fg-3 transition-colors hover:border-line-strong hover:text-fg-1 coarse:min-h-11',
                    open && 'border-brand/60 text-brand',
                    className,
                )}
                aria-label={triggerLabel}
            >
                <span>Switch</span>
                <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    aria-label={panelLabel}
                    onKeyDown={onPanelKeyDown}
                    onOpenAutoFocus={e => {
                        e.preventDefault();
                        const panel = e.currentTarget as HTMLElement | null;
                        // Touch: no keyboard over the list until the search box is tapped.
                        if (window.matchMedia('(pointer: coarse)').matches) panel?.focus();
                        else panel?.querySelector<HTMLInputElement>('input')?.focus();
                    }}
                    className={cn(
                        'z-[70] flex flex-col overflow-hidden rounded-card border border-line-strong bg-surface-1 shadow-card animate-pop-in focus:outline-none',
                        // phones: full width minus 12px each side (collisionPadding keeps it on-screen)
                        'w-[calc(100vw-24px)] max-h-[min(calc(100dvh-6rem),var(--radix-popover-content-available-height))]',
                        panelClassName,
                    )}
                >
                    {/* Below lg the focused search lights the divider under it instead of a ring that cuts the panel's rounded top. */}
                    <div className="flex items-center gap-2 border-b border-line px-3 py-1 max-lg:focus-within:border-brand/60">
                        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-3" />
                        <input
                            type="search"
                            placeholder="SEARCH"
                            aria-label={searchLabel}
                            {...inputProps}
                            value={query}
                            onChange={e => onQuery(e.target.value)}
                            className="min-h-10 w-full bg-transparent text-base text-fg-1 outline-none placeholder:tracking-label placeholder:text-fg-3 coarse:min-h-11 max-lg:focus-visible:!outline-none"
                        />
                        <Popover.Close className="inline-flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-micro font-medium uppercase tracking-chip text-fg-3 hover:text-fg-1 coarse:h-11 coarse:min-w-11">
                            Close
                        </Popover.Close>
                    </div>
                    <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-2', bodyClassName)}>{children}</div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
