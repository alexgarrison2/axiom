'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

interface HeaderCellProps {
    label: React.ReactNode;
    /** Full column name for screen readers and the native tooltip. */
    title?: string;
    /** null = sorted by another column; undefined = not sortable. */
    direction?: SortDir | null;
    onSort?: () => void;
    align?: 'left' | 'center' | 'right';
    className?: string;
    style?: React.CSSProperties;
}

/**
 * <th scope="col"> for the dense tables: mono uppercase label, cyan when it
 * is the sort column. Sortable headers are real buttons with aria-sort on
 * the cell (same contract as the SortHeader primitive, plus a native
 * tooltip carrying the full column name).
 */
export function HeaderCell({ label, title, direction, onSort, align = 'center', className, style }: HeaderCellProps) {
    const sortable = direction !== undefined && !!onSort;
    const ariaSort = !sortable ? undefined : direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
    const justify = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';
    const text = 'whitespace-nowrap text-micro font-medium uppercase tracking-[0.06em]';
    return (
        <th scope="col" aria-sort={ariaSort} className={cn('h-8 p-0 align-middle font-medium', className)} style={style}>
            {sortable ? (
                <button
                    type="button"
                    onClick={onSort}
                    title={title}
                    className={cn(
                        'inline-flex h-full min-h-8 w-full items-center px-1.5 transition-colors hover:text-fg-1 focus-visible:outline-offset-[-2px] coarse:min-h-11',
                        justify,
                        text,
                        direction ? 'text-brand' : 'text-fg-3',
                    )}
                >
                    {/* Arrow is out of flow so the label lines up with its column's values; the negative
                        margin cancels the trailing letter-spacing. */}
                    <span className={cn('relative', align === 'right' && '-mr-[0.06em]')}>
                        {label}
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
                    {title ? <span className="sr-only">, {title}</span> : null}
                </button>
            ) : (
                <span title={title} className={cn('flex min-h-8 items-center px-1.5 text-fg-3', justify, text)}>
                    {label}
                    {title ? <span className="sr-only">, {title}</span> : null}
                </span>
            )}
        </th>
    );
}

export default HeaderCell;
