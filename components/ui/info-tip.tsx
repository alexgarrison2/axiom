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
                    'group relative inline-flex items-center gap-1 rounded-chip align-middle text-fg-3 transition-colors hover:text-fg-1',
                    'min-h-6 min-w-6 justify-center',
                    // 44px hit area on touch without growing the layout
                    "coarse:before:absolute coarse:before:-inset-3 coarse:before:content-['']",
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
                {visible ? <span className="underline decoration-mute decoration-dotted underline-offset-[3px]">{visible}</span> : null}
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
                        'z-[70] w-[min(17rem,calc(100vw-24px))] rounded-control border border-line-strong bg-surface-1 px-3 py-2.5 text-left',
                        'animate-pop-in focus:outline-none',
                    )}
                >
                    <p className="label text-fg-1">{entry.title}</p>
                    <p className="mt-1.5 text-caption text-fg-2">{entry.short}</p>
                    {note ? <p className="mt-1.5 text-caption text-fg-1">{note}</p> : null}
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
                            className="mt-2 inline-flex min-h-6 items-center text-micro font-bold uppercase tracking-wide text-brand hover:underline"
                        >
                            How we calculate it →
                        </a>
                    ) : null}
                    <Popover.Arrow className="fill-line-strong" width={10} height={5} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** A 12px hairline "i": present when needed, quiet otherwise. */
function InfoGlyph() {
    return (
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none">
            <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1" />
            <path d="M6 5.4v3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="6" cy="3.6" r="0.7" fill="currentColor" />
        </svg>
    );
}

export default InfoTip;
