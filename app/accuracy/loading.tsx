/**
 * /accuracy loading shell. React reveals the prerendered page up to ~300ms
 * after this fallback paints, so the shell is shaped like the report card and
 * at least a viewport tall: the footer never paints above the fold and then
 * jumps (that jump was the page's desktop CLS).
 */
export default function Loading() {
    const block = 'animate-pulse bg-surface-2 motion-reduce:animate-none';
    return (
        <main aria-busy="true" className="pb-tabbar min-h-[calc(100svh-var(--appbar-h,56px))]">
            <p role="status" className="sr-only">
                Loading…
            </p>
            <div aria-hidden="true" className="mx-auto max-w-[1400px] px-4 py-5 md:px-6 md:py-7">
                <div className="flex items-center gap-3">
                    <div className={`h-8 w-40 rounded-control ${block}`} />
                    <div className={`ml-auto hidden h-8 w-64 rounded-control sm:block ${block}`} />
                </div>
                <div className={`mt-6 h-5 w-32 rounded ${block}`} />
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="panel h-[92px] md:h-[112px]" />
                    ))}
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="panel h-56" />
                    <div className="panel h-56" />
                </div>
            </div>
        </main>
    );
}
