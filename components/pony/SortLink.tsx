'use client';

import type * as React from 'react';
import { useRouter } from 'next/navigation';
import { SortHeader, type SortDirection } from '@/components/ui/sort-header';

/** A leaderboard column header that re-ranks through the URL (the server sorts). */
export function SortLink({ href, direction, label, title, className }: { href: string; direction: SortDirection | null; label: React.ReactNode; title?: string; className?: string }) {
    const router = useRouter();
    return (
        <SortHeader direction={direction} onSort={() => router.replace(href, { scroll: false })} align="right" title={title} className={className}>
            {label}
        </SortHeader>
    );
}
