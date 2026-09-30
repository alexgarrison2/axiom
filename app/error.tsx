'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** Route-level error boundary: a retry and a way home. The nav (layout) stays usable. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
            <p className="label text-neg">Error</p>
            <h1 className="heading-page mt-3">Something broke</h1>
            {error.digest ? <p className="mt-3 text-micro uppercase tracking-wide text-fg-3">Ref {error.digest}</p> : null}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                    type="button"
                    onClick={() => reset()}
                    className="inline-flex min-h-11 items-center rounded-control bg-brand px-5 text-caption font-bold uppercase tracking-chip text-brand-ink transition-[filter] hover:brightness-110"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="inline-flex min-h-11 items-center rounded-control border border-line px-5 text-caption font-bold uppercase tracking-chip text-fg-1 transition-colors hover:border-line-strong"
                >
                    Go to today&apos;s games
                </Link>
            </div>
        </main>
    );
}
