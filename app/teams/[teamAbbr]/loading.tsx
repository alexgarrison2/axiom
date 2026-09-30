/** Skeleton matching the team page: breadcrumb, hero with KPI tiles, tabs, rows. */
export default function TeamLoading() {
    return (
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-3 md:px-6 md:pt-5" aria-busy="true">
            <p className="sr-only" role="status">
                Loading team…
            </p>
            <div className="mb-3 flex items-center justify-between">
                <div className="h-5 w-32 rounded-chip bg-surface-2" />
                <div className="h-9 w-36 rounded-control bg-surface-2" />
            </div>
            <div className="hud-panel overflow-hidden">
                <div className="flex items-center gap-4 p-4 md:p-6">
                    <div className="h-12 w-12 rounded-full bg-surface-2 md:h-16 md:w-16" />
                    <div className="space-y-2">
                        <div className="h-7 w-56 rounded-chip bg-surface-2" />
                        <div className="h-4 w-40 rounded-chip bg-surface-2" />
                    </div>
                </div>
                <div className="mx-4 mb-4 h-12 w-48 rounded-chip bg-surface-2 md:mx-6" />
                <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-20 bg-surface-1" />
                    ))}
                </div>
            </div>
            <div className="mt-6 h-10 w-72 rounded-control bg-surface-2" />
            <div className="mt-4 space-y-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-control bg-surface-1" />
                ))}
            </div>
        </main>
    );
}
