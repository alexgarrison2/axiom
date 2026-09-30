'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

/**
 * Accessible modal dialog (Radix): role=dialog + aria-modal, labelled by its
 * title, focus trapped inside, Esc closes, focus returns to the trigger.
 *
 *   <Dialog title="Odds movement" description="…" trigger={<button>History</button>}>
 *     …content…
 *   </Dialog>
 */
export interface DialogProps {
    title: React.ReactNode;
    /** Announced to screen readers only (no visible sub-copy). */
    description?: React.ReactNode;
    /** Hide the title visually (still announced). */
    hideTitle?: boolean;
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    /** Accessible name for the close button. */
    closeLabel?: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };

export function Dialog({
    title,
    description,
    hideTitle,
    trigger,
    open,
    onOpenChange,
    children,
    footer,
    closeLabel = 'Close',
    size = 'md',
    className,
}: DialogProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
                <DialogPrimitive.Content
                    className={cn(
                        'fixed inset-0 z-[61] m-auto flex h-fit max-h-[min(85dvh,860px)] w-[calc(100vw-24px)] flex-col',
                        'panel border-line-strong shadow-[0_24px_64px_-24px_rgba(0,0,0,.8)] animate-pop-in focus:outline-none',
                        sizes[size],
                        className,
                    )}
                    {...(description ? {} : { 'aria-describedby': undefined })}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-line px-card py-3">
                        <div className="min-w-0">
                            <DialogPrimitive.Title className={cn('font-display text-title font-bold uppercase tracking-[0.04em] text-fg-1', hideTitle && 'sr-only')}>{title}</DialogPrimitive.Title>
                            {description ? (
                                <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
                            ) : null}
                        </div>
                        <DialogClose label={closeLabel} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-card py-3">{children}</div>
                    {footer ? <div className="border-t border-line px-card py-3">{footer}</div> : null}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

export function DialogClose({ label = 'Close', className }: { label?: string; className?: string }) {
    return (
        <DialogPrimitive.Close
            aria-label={label}
            className={cn(
                '-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-fg-3 transition-colors hover:text-fg-1 coarse:h-11 coarse:w-11',
                className,
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
        </DialogPrimitive.Close>
    );
}

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export default Dialog;
