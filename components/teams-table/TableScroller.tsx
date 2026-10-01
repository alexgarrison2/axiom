import * as React from 'react';
import { cn } from '@/lib/utils';
import { SCROLLER } from './table-style';

/**
 * Keyboard-reachable two-axis scroll container for a sticky-header table
 * (role=region, tabIndex=0, aria-label). Unlike ScrollRegion it has no edge
 * fade masks: a mask would also fade the pinned first column.
 */
export function TableScroller({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
    return (
        <div role="region" aria-label={label} tabIndex={0} className={cn(SCROLLER, className)}>
            {children}
        </div>
    );
}
