/** Skeleton that matches the /teams layout (heading row, sections, dense rows). */
export default function TeamsLoading() {
    return (
        <main className="page pb-tabbar pt-4 md:pt-6" aria-busy="true">
            <p className="sr-only" role="status">
                Loading teams
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="h-7 w-28 rounded-chip bg-surface-2" />
                <div className="h-9 w-44 rounded-control bg-surface-2" />
                <div className="h-9 w-56 rounded-full bg-surface-2" />
            </div>
            <div className="mb-3 h-8 w-full max-w-2xl rounded-control bg-surface-2" />
            <div className="panel overflow-hidden">
                {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="flex h-8 items-center gap-3 border-b border-line px-3">
                        <div className="h-5 w-5 rounded-full bg-surface-2" />
                        <div className="h-3 w-10 rounded-chip bg-surface-2" />
                        <div className="h-3 flex-1 rounded-chip bg-surface-2/60" />
                    </div>
                ))}
            </div>
        </main>
    );
}
