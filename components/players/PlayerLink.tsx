'use client';

import Link from 'next/link';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A player's name as a link to his page. Stops the click from reaching a
 * clickable row or card it sits in (goal cards, table rows), so the name opens
 * the player and the rest of the row keeps its own action.
 */
export function PlayerLink({ id, children, className }: { id: number; children: React.ReactNode; className?: string }) {
    return (
        <Link
            href={`/players/${id}`}
            onClick={e => e.stopPropagation()}
            className={cn('rounded-[2px] underline-offset-4 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand', className)}
        >
            {children}
        </Link>
    );
}
