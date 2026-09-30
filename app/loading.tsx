/**
 * Route loading shell: a skeleton of the slate (heading rail + matchup
 * cards) in the page's real layout, so navigation feels instant and nothing
 * jumps when data arrives. Pulses twice, and not at all under reduced motion.
 * At least a viewport tall: React paints this fallback before revealing a
 * prerendered page (large boundaries are streamed), and a shorter shell put
 * the footer on screen and then shoved it off (desktop CLS ~0.07).
 */
export default function Loading() {
    const block = 'animate-pulse bg-surface-2';
    return (
        <main aria-busy="true" className="mx-auto min-h-[calc(100svh-var(--appbar-h,56px))] max-w-[1180px] px-4 pt-5 md:px-5 md:pt-7">
            <p role="status" className="sr-only">
                Loading…
            </p>
            <div aria-hidden="true">
                <div className="mb-6 flex items-center gap-2.5">
                    <div className={`mr-3 h-7 w-44 rounded-control ${block}`} />
                    {[0, 1, 2].map(i => (
                        <div key={i} className={`h-[34px] w-24 rounded-full ${block}`} />
                    ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="panel p-card">
                            <div className="flex items-center justify-between">
                                <div className={`h-3.5 w-20 rounded ${block}`} />
                                <div className={`h-4 w-10 rounded-chip ${block}`} />
                            </div>
                            <div className="my-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`h-14 w-14 rounded-full md:h-[84px] md:w-[84px] ${block}`} />
                                    <div className={`h-4 w-24 rounded ${block}`} />
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className={`h-4 w-24 rounded ${block}`} />
                                    <div className={`h-14 w-14 rounded-full md:h-[84px] md:w-[84px] ${block}`} />
                                </div>
                            </div>
                            <div className={`h-[50px] rounded-bar ${block}`} />
                            <div className="mt-4 flex justify-between">
                                <div className={`h-4 w-12 rounded ${block}`} />
                                <div className={`h-4 w-12 rounded ${block}`} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
