/**
 * Route loading shell: a skeleton of the slate (heading rail + matchup
 * cards) in the page's real layout, so navigation feels instant and nothing
 * jumps when data arrives. Pulses twice, and not at all under reduced motion.
 */
export default function Loading() {
    const block = 'animate-pulse bg-surface-2';
    return (
        <main aria-busy="true" className="page pt-5 md:pt-7 [&>*]:max-w-[1192px]">
            <p role="status" className="sr-only">
                Loading…
            </p>
            <div aria-hidden="true">
                <div className="mb-6 flex items-center gap-2.5 overflow-hidden">
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
                                    <div className={`h-4 w-14 rounded min-[400px]:w-24 ${block}`} />
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className={`h-4 w-14 rounded min-[400px]:w-24 ${block}`} />
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
