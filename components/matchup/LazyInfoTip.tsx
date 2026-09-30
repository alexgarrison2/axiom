'use client';

import { useRef, useState, type ComponentType } from 'react';
import type { InfoTipProps } from '@/components/ui/info-tip';
import type { GlossaryTerm } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * An <InfoTip> that costs no JS until it is used: the collapsed card renders
 * a look-alike button, and the first tap/click/Enter loads the real
 * (Radix Popover) tip and opens it. Keeps ~17KB off the home page's first load.
 */
export function LazyInfoTip({ term, label, className }: { term: GlossaryTerm; label: string; className?: string }) {
    const [Tip, setTip] = useState<ComponentType<InfoTipProps> | null>(null);
    const ref = useRef<HTMLSpanElement>(null);

    if (Tip) {
        return (
            <span ref={ref} className="inline-flex">
                <Tip term={term} className={className} />
            </span>
        );
    }

    const load = () =>
        import('@/components/ui/info-tip').then(m => {
            setTip(() => m.InfoTip);
            // Programmatic focus opens the tip (InfoTip opens on keyboard-style focus).
            requestAnimationFrame(() => ref.current?.querySelector('button')?.focus());
        });

    return (
        <button
            type="button"
            aria-label={label}
            onClick={load}
            onPointerEnter={() => void import('@/components/ui/info-tip')}
            className={cn(
                'inline-flex min-h-6 min-w-6 items-center justify-center rounded-chip align-middle text-fg-2 transition-colors hover:text-fg-1 coarse:min-h-11 coarse:min-w-11',
                className,
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
                <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
            </svg>
        </button>
    );
}

export default LazyInfoTip;
