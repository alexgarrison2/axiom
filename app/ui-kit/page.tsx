import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import { PRIOR_SEASON_TAG } from '@/components/ui/stat-chip';
import { WinBarLegend } from '@/components/ui/win-bar';
import Kit from './Kit';

export const metadata: Metadata = {
    title: 'UI kit',
    robots: { index: false, follow: false },
};

/**
 * Living reference for the Neon Arcade tokens and primitives (components/ui/*).
 * Also the fixture page for tests/design-system.spec.ts (axe + keyboard).
 * Not linked from the site; disallowed in robots.ts.
 */
export default function UiKitPage() {
    return (
        <main className="page pb-10 pt-5 md:pt-7">
            <PageHeading title="UI kit" tag={PRIOR_SEASON_TAG} actions={<WinBarLegend className="ml-auto" />} className="mb-6" />
            <Kit />
        </main>
    );
}
