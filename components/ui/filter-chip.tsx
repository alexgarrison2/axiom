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
 * A toggle chip for filters (aria-pressed). Same selected style as
 * <Segmented>: surface fill + brand inner ring. ≥36px tall (44px on touch).
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
                'inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-body-sm font-semibold transition-colors coarse:min-h-11',
                selected
                    ? 'border-transparent bg-surface-3 text-fg-1 shadow-[inset_0_0_0_1px_rgb(var(--brand-rgb))]'
                    : 'border-line bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg-1',
                className,
            )}
            {...rest}
        >
            {leading}
            <span>{children}</span>
            {count != null ? (
                <span className={cn('rounded-full px-1.5 text-micro tabular-nums', selected ? 'bg-brand/15 text-brand' : 'bg-fg-3/15 text-fg-2')}>{count}</span>
            ) : null}
            {removable ? (
                <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-fg-2">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
            ) : null}
        </button>
    );
});

export default FilterChip;
