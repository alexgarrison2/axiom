'use client';

import * as React from 'react';
import { PINNED_HEAD_HIDE, StickyHead, TableScroller } from '@/components/teams-table/TableScroller';
import { cn } from '@/lib/utils';
import { ScrollHint } from './ScrollHint';

/** Body cells of a pinned-header table: the header cells' min width, where the copy stands in for the real <thead>. */
export const PIN_COL = 'max-lg:min-w-[3.25rem] [@media(max-height:500px)]:min-w-[3.25rem]';

const TABLE = 'w-full border-separate border-spacing-0 text-caption tabular-nums';

/**
 * A game table whose header stays in view. Wide screens: the table scrolls in
 * its own box with a sticky <thead>, as before. Below lg and on short screens
 * the page scrolls the rows and a copy of the header (StickyHead) pins under
 * the app bar and the section rail, sized to the real columns and following
 * the table's sideways scroll. `head` is the header row(s); children are the
 * body and footer.
 */
export function PinnedTable({ label, head, children }: { label: string; head: React.ReactNode; children: React.ReactNode }) {
    const headRef = React.useRef<HTMLDivElement>(null);
    const tableRef = React.useRef<HTMLTableElement>(null);
    const [cols, setCols] = React.useState<{ widths: number[]; total: number } | null>(null);
    const onScrollX = React.useCallback((left: number) => {
        if (headRef.current) headRef.current.scrollLeft = left;
    }, []);

    // The copy's columns take the real table's widths (its widest row; separator rows span columns).
    React.useEffect(() => {
        const table = tableRef.current;
        if (!table || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr, tfoot > tr')];
            const row = rows.reduce<HTMLTableRowElement | null>((best, r) => (!best || r.cells.length > best.cells.length ? r : best), null);
            if (!row) return;
            const widths = [...row.cells].map(c => c.getBoundingClientRect().width);
            const total = table.getBoundingClientRect().width;
            setCols(prev => (prev && prev.total === total && prev.widths.length === widths.length && prev.widths.every((w, i) => Math.abs(w - widths[i]) < 0.5) ? prev : { widths, total }));
        };
        // Re-measure on size changes and on new rows or values (a team or view switch keeps the total width), once per frame.
        let frame = 0;
        const queue = () => {
            if (!frame) frame = requestAnimationFrame(() => {
                frame = 0;
                measure();
            });
        };
        measure();
        const ro = new ResizeObserver(queue);
        ro.observe(table);
        const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(queue) : null;
        mo?.observe(table, { childList: true, subtree: true, characterData: true });
        return () => {
            cancelAnimationFrame(frame);
            ro.disconnect();
            mo?.disconnect();
        };
    }, []);

    return (
        <div className="relative">
            <StickyHead ref={headRef} className="top-[calc(var(--appbar-h)+var(--vv-top,0px)+var(--game-rail-h,0px))] bg-bg">
                <table className={cn(TABLE, 'table-fixed')} style={cols ? { width: cols.total } : undefined}>
                    {cols ? (
                        <colgroup>
                            {cols.widths.map((w, i) => (
                                <col key={i} style={{ width: w }} />
                            ))}
                        </colgroup>
                    ) : null}
                    <thead>{head}</thead>
                </table>
            </StickyHead>
            <TableScroller label={label} pageScroll fade={false} onScrollX={onScrollX}>
                <table ref={tableRef} className={TABLE}>
                    <thead className={PINNED_HEAD_HIDE}>{head}</thead>
                    {children}
                </table>
            </TableScroller>
            <ScrollHint />
        </div>
    );
}
