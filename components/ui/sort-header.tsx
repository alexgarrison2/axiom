'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface SortHeaderProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> {
    /** Column label. */
    children: React.ReactNode;
    /** This column's sort direction, or null when another column is sorted. */
    direction: SortDirection | null;
    onSort: () => void;
    align?: 'left' | 'right' | 'center';
}

/**
 * A sortable column header: a real <button> inside <th scope="col"> with
 * aria-sort, so sorting works from the keyboard and is announced.
 */
export function SortHeader({ children, direction, onSort, align = 'left', className, ...rest }: SortHeaderProps) {
    return (
        <th
            scope="col"
            aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
            className={cn('p-0 font-semibold', className)}
            {...rest}
        >
            <button
                type="button"
                onClick={onSort}
                className={cn(
                    'inline-flex min-h-9 w-full items-center gap-1 px-2 text-micro uppercase tracking-[0.06em] transition-colors hover:text-fg-1 coarse:min-h-11',
                    align === 'right' && 'justify-end',
                    align === 'center' && 'justify-center',
                    direction ? 'text-brand' : 'text-fg-2',
                )}
            >
                <span>{children}</span>
                <svg aria-hidden="true" viewBox="0 0 10 12" className={cn('h-3 w-2.5 shrink-0', direction ? 'opacity-100' : 'opacity-40')}>
                    <path d="M5 1.5L8 5H2z" fill="currentColor" opacity={direction === 'desc' ? 0.35 : 1} />
                    <path d="M5 10.5L2 7h6z" fill="currentColor" opacity={direction === 'asc' ? 0.35 : 1} />
                </svg>
            </button>
        </th>
    );
}

export default SortHeader;
