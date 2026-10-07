'use client';

import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';

/**
 * A panel's control bar. Wide screens wrap the controls onto as many rows as
 * they need; phones keep them on one line that scrolls sideways (edge fades
 * show there is more), so the data starts after one row instead of three or
 * four. The border sits on the outer box so the fade never eats it.
 */
export function ControlRow({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
    return (
        <div className="border-b border-line">
            <ScrollRegion
                label={label}
                className={cn(
                    'flex items-center gap-2 px-card py-2 scrollbar-hide max-sm:flex-nowrap max-sm:[&>*]:shrink-0 max-sm:[&>[role=radiogroup]]:max-w-none sm:flex-wrap',
                    className,
                )}
            >
                {children}
            </ScrollRegion>
        </div>
    );
}
