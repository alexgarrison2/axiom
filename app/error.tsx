'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** Route-level error boundary: explain, offer a retry and a way home. The nav (layout) stays usable. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
            <div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full border border-neg/40 bg-neg/10 text-neg">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 8v5M12 16.5v.01" />
                    <circle cx="12" cy="12" r="9" />
                </svg>
            </div>
            <p className="hud-label mt-5 text-neg">Something broke</p>
            <h1 className="mt-2 text-h2 font-black text-fg-1">We couldn&apos;t load this page.</h1>
            <p className="mt-3 text-body text-fg-2">
                It&apos;s usually a data file mid-update. Try again in a moment — the rest of the site should still work.
            </p>
            {error.digest ? <p className="mt-2 font-mono text-caption text-fg-3">Ref {error.digest}</p> : null}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                    type="button"
                    onClick={() => reset()}
                    className="inline-flex min-h-11 items-center rounded-control bg-brand px-5 text-body-sm font-bold text-brand-ink transition-[filter] hover:brightness-110"
                >
                    Try again
                </button>
                <Link href="/" className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-5 text-body-sm font-semibold text-fg-1 hover:bg-surface-2">
                    Go to today&apos;s games
                </Link>
            </div>
        </main>
    );
}
