import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import Kit from './Kit';

export const metadata: Metadata = {
    title: 'UI kit',
    robots: { index: false, follow: false },
};

/**
 * Living reference for the Neon Rink HUD primitives (components/ui/*).
 * Also the fixture page for tests/design-system.spec.ts (axe + keyboard).
 * Not linked from the site; disallowed in robots.ts.
 */
export default function UiKitPage() {
    return (
        <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
            <PageHeading eyebrow="Design system" title="Neon Rink HUD" description="Tokens and primitives every page is built from." className="mb-8" />
            <Kit />
        </main>
    );
}
