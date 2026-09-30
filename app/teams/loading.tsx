/** Skeleton that matches the /teams layout (heading, toolbar, table). */
export default function TeamsLoading() {
    return (
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-5 md:px-6 md:pt-8" aria-busy="true">
            <p className="sr-only" role="status">
                Loading teams…
            </p>
            <div className="mb-5 space-y-2">
                <div className="h-3 w-28 rounded-chip bg-surface-2" />
                <div className="h-8 w-40 rounded-chip bg-surface-2" />
                <div className="h-4 w-80 max-w-full rounded-chip bg-surface-2" />
            </div>
            <div className="mb-3 flex gap-2">
                <div className="h-9 w-44 rounded-control bg-surface-2" />
                <div className="h-9 w-20 rounded-full bg-surface-2" />
                <div className="h-9 w-20 rounded-full bg-surface-2" />
                <div className="h-9 w-24 rounded-control bg-surface-2" />
            </div>
            <div className="hud-panel overflow-hidden">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-2.5">
                        <div className="h-7 w-7 rounded-full bg-surface-2" />
                        <div className="h-4 w-16 rounded-chip bg-surface-2" />
                        <div className="h-4 flex-1 rounded-chip bg-surface-2/60" />
                    </div>
                ))}
            </div>
        </main>
    );
}
