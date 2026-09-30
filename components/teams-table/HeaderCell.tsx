'use client';

import * as React from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import type { GlossaryTerm } from '@/lib/glossary';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

interface HeaderCellProps {
    label: React.ReactNode;
    /** Full column name for screen readers and the native tooltip. */
    title?: string;
    tip?: GlossaryTerm;
    /** null = sorted by another column; undefined = not sortable. */
    direction?: SortDir | null;
    onSort?: () => void;
    align?: 'left' | 'center' | 'right';
    className?: string;
    style?: React.CSSProperties;
}

/**
 * <th scope="col"> for data tables. Sortable headers are real buttons with
 * aria-sort on the cell; jargon headers carry a glossary InfoTip next to
 * the button (never nested inside it).
 */
export function HeaderCell({ label, title, tip, direction, onSort, align = 'center', className, style }: HeaderCellProps) {
    const sortable = direction !== undefined && !!onSort;
    const ariaSort = !sortable ? undefined : direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
    return (
        <th scope="col" aria-sort={ariaSort} className={cn('p-0 align-bottom font-semibold', className)} style={style}>
            <div className={cn('flex min-h-9 items-center gap-0.5 px-1.5', align === 'center' && 'justify-center', align === 'right' && 'justify-end')}>
                {sortable ? (
                    <button
                        type="button"
                        onClick={onSort}
                        title={title}
                        className={cn(
                            'inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-chip px-1 text-micro tracking-[0.02em] transition-colors hover:text-fg-1 coarse:min-h-11',
                            direction ? 'text-brand' : 'text-fg-2',
                        )}
                    >
                        <span>{label}</span>
                        {title ? <span className="sr-only">, {title}</span> : null}
                        <svg aria-hidden="true" viewBox="0 0 10 12" className={cn('h-3 w-2 shrink-0', direction ? 'opacity-100' : 'opacity-40')}>
                            <path d="M5 1.5L8 5H2z" fill="currentColor" opacity={direction === 'desc' ? 0.3 : 1} />
                            <path d="M5 10.5L2 7h6z" fill="currentColor" opacity={direction === 'asc' ? 0.3 : 1} />
                        </svg>
                    </button>
                ) : (
                    <span title={title} className="whitespace-nowrap px-1 text-micro tracking-[0.02em] text-fg-2">
                        {label}
                        {title ? <span className="sr-only">, {title}</span> : null}
                    </span>
                )}
                {tip ? <InfoTip term={tip} side="bottom" className="-ml-0.5 text-fg-3" /> : null}
            </div>
        </th>
    );
}

export default HeaderCell;
