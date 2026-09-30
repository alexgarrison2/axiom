import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
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
        <main className="mx-auto max-w-[1180px] px-4 pb-10 pt-5 md:px-5 md:pt-7">
            <PageHeading title="UI kit" className="mb-6" />
            <Kit />
        </main>
    );
}
