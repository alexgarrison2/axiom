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
                    'inline-flex min-h-8 w-full min-w-6 items-center px-2 text-micro uppercase tracking-[0.06em] transition-colors hover:text-fg-1 coarse:min-h-11',
                    align === 'right' && 'justify-end',
                    align === 'center' && 'justify-center',
                    direction ? 'text-brand' : 'text-fg-3',
                )}
            >
                {/* The arrow is taken out of flow so the label's edge lines up with the cell values below it;
                    the negative margin cancels the trailing letter-spacing on the last glyph. */}
                <span className={cn('relative', align === 'right' && '-mr-[0.06em]')}>
                    {children}
                    {direction ? (
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 8 8"
                            className={cn('absolute top-1/2 h-2 w-2 -translate-y-1/2', align === 'right' ? 'right-full mr-1' : 'left-full ml-1')}
                        >
                            <path d={direction === 'asc' ? 'M4 1.5 7 6H1z' : 'M4 6.5 1 2h6z'} fill="currentColor" />
                        </svg>
                    ) : null}
                </span>
            </button>
        </th>
    );
}

export default SortHeader;
