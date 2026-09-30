'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';
import { DialogClose } from './dialog';

export interface FilterSheetProps {
    /** Number of active filters — shown as a badge on the trigger. */
    activeCount?: number;
    title?: string;
    description?: string;
    triggerLabel?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Clear all filters. Shows a "Reset" button when provided. */
    onReset?: () => void;
    /** Label for the primary close button, e.g. "Show 24 games". */
    applyLabel?: string;
    children: React.ReactNode;
    className?: string;
    triggerClassName?: string;
}

/**
 * Filters live behind one button. Bottom sheet on phones, side sheet from
 * md up. Focus is trapped while open and returns to the trigger on close.
 */
export function FilterSheet({
    activeCount = 0,
    title = 'Filters',
    description,
    triggerLabel = 'Filters',
    open,
    onOpenChange,
    onReset,
    applyLabel = 'Done',
    children,
    className,
    triggerClassName,
}: FilterSheetProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Trigger
                className={cn(
                    'inline-flex min-h-[34px] items-center gap-2 rounded-full border border-line px-3.5 text-micro font-medium uppercase tracking-chip text-fg-3 transition-colors hover:border-line-strong hover:text-fg-1 coarse:min-h-11 md:text-caption',
                    activeCount > 0 && 'border-brand/60 text-brand',
                    triggerClassName,
                )}
            >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                    <path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
                {triggerLabel}
                {activeCount > 0 ? (
                    <span className="font-bold tabular-nums text-brand">
                        {activeCount}
                        <span className="sr-only"> active</span>
                    </span>
                ) : null}
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-bg/70 backdrop-blur-sm animate-fade-in" />
                <DialogPrimitive.Content
                    {...(description ? {} : { 'aria-describedby': undefined })}
                    className={cn(
                        'fixed z-[61] flex flex-col border-line-strong bg-surface-1 focus:outline-none',
                        // phone: bottom sheet
                        'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-card border-t pb-[env(safe-area-inset-bottom)] animate-sheet-up',
                        // md+: right side sheet
                        'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-card md:border-l md:border-t-0 md:pb-0 md:animate-sheet-left',
                        className,
                    )}
                >
                    <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-fg-3/40 md:hidden" />
                    <div className="flex items-center justify-between gap-3 px-card pb-2 pt-3 md:pt-4">
                        <div>
                            <DialogPrimitive.Title className="font-display text-title font-bold uppercase tracking-[0.04em] text-fg-1">{title}</DialogPrimitive.Title>
                            {description ? <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description> : null}
                        </div>
                        <DialogClose label="Close filters" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-card pb-4">{children}</div>
                    <div className="flex items-center gap-2 border-t border-line px-card py-3">
                        {onReset ? (
                            <button
                                type="button"
                                onClick={onReset}
                                disabled={activeCount === 0}
                                className="min-h-10 rounded-control px-3 text-caption font-bold uppercase tracking-chip text-fg-3 hover:text-fg-1 disabled:text-fg-disabled coarse:min-h-11"
                            >
                                Reset
                            </button>
                        ) : null}
                        <DialogPrimitive.Close className="ml-auto min-h-10 rounded-control bg-brand px-4 text-caption font-bold uppercase tracking-chip text-brand-ink transition-[filter] hover:brightness-110 coarse:min-h-11">
                            {applyLabel}
                        </DialogPrimitive.Close>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

export default FilterSheet;
