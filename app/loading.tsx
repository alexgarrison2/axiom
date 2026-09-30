/**
 * Route loading shell: a skeleton of the slate (header strip + cards) in the
 * page's real layout, so navigation feels instant and nothing jumps when data
 * arrives. The shimmer is CSS-only and switched off under reduced motion.
 */
export default function Loading() {
    return (
        <main aria-busy="true" className="mx-auto max-w-[1800px] px-4 pt-4 md:px-6 md:pt-6">
            <p role="status" className="sr-only">
                Loading…
            </p>
            <div aria-hidden="true">
                <div className="mb-4 flex gap-2">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-surface-2" />
                    ))}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="hud-panel p-5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" />
                                    <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
                                </div>
                                <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
                                <div className="flex items-center gap-3">
                                    <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
                                    <div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" />
                                </div>
                            </div>
                            <div className="mt-5 h-8 animate-pulse rounded-control bg-surface-2" />
                            <div className="mt-4 flex gap-2">
                                <div className="h-6 w-20 animate-pulse rounded-chip bg-surface-2" />
                                <div className="h-6 w-16 animate-pulse rounded-chip bg-surface-2" />
                                <div className="h-6 w-24 animate-pulse rounded-chip bg-surface-2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
