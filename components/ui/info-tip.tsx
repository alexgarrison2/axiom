'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { GLOSSARY, type GlossaryEntry, type GlossaryTerm } from '../../lib/glossary';
import { cn } from '../../lib/utils';

export interface InfoTipProps {
    /** Key in lib/glossary.ts. */
    term: GlossaryTerm;
    /** Visible text next to the icon (defaults to icon-only). */
    children?: React.ReactNode;
    /** Show the glossary label as visible trigger text. */
    showLabel?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    className?: string;
    /** Extra game-specific sentence shown in the tip (e.g. the current blend weight). */
    note?: string;
}

const TABBABLE =
    'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focus the next tabbable element after `from` in document order, skipping `skip` (the portalled tip). */
function focusNextAfter(from: HTMLElement, skip: HTMLElement | null) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
        el => (el === from || el.getClientRects().length > 0) && !(skip && skip.contains(el)),
    );
    const next = all[all.indexOf(from) + 1];
    (next ?? from).focus();
}

/**
 * A glossary explainer. Opens on tap, click, Enter/Space, or keyboard focus;
 * closes on Esc (focus returns to the trigger), outside click or blur.
 * The tip is portalled to <body> so a card's overflow or transform never
 * clips it. Tab from the open trigger steps into the tip's "How we calculate
 * it" link; Tab from there continues with whatever follows the trigger.
 */
export function InfoTip({ term, children, showLabel = false, side = 'top', className, note }: InfoTipProps) {
    const entry: GlossaryEntry | undefined = GLOSSARY[term];
    const [open, setOpen] = React.useState(false);
    const pointerDown = React.useRef(false);
    const openedByFocus = React.useRef(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const linkRef = React.useRef<HTMLAnchorElement>(null);

    if (!entry) return <>{children}</>;

    const visible = children ?? (showLabel ? entry.label : null);

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
                ref={triggerRef}
                type="button"
                aria-label={visible ? undefined : `What is ${entry.title}?`}
                className={cn(
                    'group inline-flex items-center gap-1 rounded-chip align-middle text-fg-2 transition-colors hover:text-fg-1',
                    'min-h-6 min-w-6 coarse:min-h-11 coarse:min-w-11 justify-center',
                    'data-[state=open]:text-brand',
                    className,
                )}
                onPointerDown={() => {
                    pointerDown.current = true;
                }}
                onFocus={() => {
                    // Keyboard focus opens the tip; pointer focus waits for the click.
                    if (!pointerDown.current && !open) {
                        openedByFocus.current = true;
                        setOpen(true);
                    }
                    pointerDown.current = false;
                }}
                onClick={(e) => {
                    // Enter/Space right after a focus-open keeps it open instead of toggling shut.
                    if (openedByFocus.current) {
                        openedByFocus.current = false;
                        e.preventDefault();
                        setOpen(true);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && open) {
                        e.preventDefault();
                        openedByFocus.current = false;
                        setOpen(false);
                    } else if (e.key === 'Tab' && !e.shiftKey && open && linkRef.current) {
                        // The tip lives in a portal: its link is the next stop.
                        e.preventDefault();
                        linkRef.current.focus();
                    }
                }}
            >
                {visible ? <span className="underline decoration-dotted decoration-fg-3 underline-offset-[3px]">{visible}</span> : null}
                <InfoGlyph />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    ref={contentRef}
                    role="dialog"
                    aria-label={entry.title}
                    side={side}
                    align="center"
                    sideOffset={6}
                    collisionPadding={12}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={() => {
                        openedByFocus.current = false;
                    }}
                    className={cn(
                        'z-[70] w-[min(18rem,calc(100vw-24px))] rounded-control border border-line-strong bg-surface-2 p-3 text-left shadow-card',
                        'animate-pop-in focus:outline-none',
                    )}
                >
                    <p className="text-body-sm font-semibold text-fg-1">{entry.title}</p>
                    <p className="mt-1 text-body-sm text-fg-2">{entry.short}</p>
                    {note ? <p className="mt-2 text-body-sm text-fg-1">{note}</p> : null}
                    {entry.detail ? <p className="mt-2 text-caption text-fg-3">{entry.detail}</p> : null}
                    {entry.anchor ? (
                        <a
                            ref={linkRef}
                            href={`/methodology#${entry.anchor}`}
                            onKeyDown={(e) => {
                                if (e.key !== 'Tab' || !triggerRef.current) return;
                                e.preventDefault();
                                const trigger = triggerRef.current;
                                openedByFocus.current = false;
                                setOpen(false);
                                if (e.shiftKey) trigger.focus();
                                else focusNextAfter(trigger, contentRef.current);
                            }}
                            className="mt-2 inline-flex min-h-6 items-center text-caption font-semibold text-brand hover:underline"
                        >
                            How we calculate it →
                        </a>
                    ) : null}
                    <Popover.Arrow className="fill-surface-2" width={12} height={6} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function InfoGlyph() {
    return (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
            <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
    );
}

export default InfoTip;
