'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface FilterChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    selected: boolean;
    onSelectedChange?: (selected: boolean) => void;
    /** Optional count badge (e.g. matching rows). */
    count?: number;
    /** Render a remove "×" (for active-filter summaries). */
    removable?: boolean;
    leading?: React.ReactNode;
}

/**
 * A pill toggle (aria-pressed) for date rails and filters: mono uppercase,
 * 1px line; selected = cyan text + cyan edge glow. The optional count sits
 * after the label (dim, cyan when selected). ≥34px tall (44px on touch).
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
    { selected, onSelectedChange, count, removable, leading, className, children, onClick, ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type="button"
            aria-pressed={removable ? undefined : selected}
            onClick={e => {
                onClick?.(e);
                if (!e.defaultPrevented) onSelectedChange?.(!selected);
            }}
            className={cn(
                'inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-micro font-medium uppercase tracking-chip transition-[color,border-color,box-shadow] coarse:min-h-11 md:text-caption',
                selected
                    ? 'border-brand/60 text-brand shadow-[inset_0_0_12px_rgb(var(--brand-rgb)/0.12),0_0_16px_rgb(var(--brand-rgb)/0.18)]'
                    : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                className,
            )}
            {...rest}
        >
            {leading}
            <span>{children}</span>
            {count != null ? (
                <span className={cn('font-bold tabular-nums', selected ? 'text-brand' : 'text-fg-3')}>{count}</span>
            ) : null}
            {removable ? (
                <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
            ) : null}
        </button>
    );
});

export default FilterChip;
