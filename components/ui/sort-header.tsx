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
            className={cn('p-0 font-medium', className)}
            {...rest}
        >
            <button
                type="button"
                onClick={onSort}
                className={cn(
                    'inline-flex min-h-8 w-full items-center gap-1 px-2 text-micro uppercase tracking-[0.12em] transition-colors hover:text-fg-1 coarse:min-h-11',
                    align === 'right' && 'justify-end',
                    align === 'center' && 'justify-center',
                    direction ? 'text-brand' : 'text-fg-3',
                )}
            >
                <span>{children}</span>
                <svg aria-hidden="true" viewBox="0 0 8 8" className={cn('h-2 w-2 shrink-0', !direction && 'invisible')}>
                    <path d={direction === 'asc' ? 'M4 1.5 7 6H1z' : 'M4 6.5 1 2h6z'} fill="currentColor" />
                </svg>
            </button>
        </th>
    );
}

export default SortHeader;
