/** Skeleton matching the team page: breadcrumb, hero (crest, record, next game, KPI tiles), tabs, rows. */
export default function TeamLoading() {
    return (
        <main className="mx-auto w-full max-w-[1800px] px-4 pb-tabbar pt-2 md:px-6 md:pt-4" aria-busy="true">
            <p className="sr-only" role="status">
                Loading team
            </p>
            <div className="mb-2 flex h-8 items-center justify-between">
                <div className="h-3 w-24 rounded-chip bg-surface-2" />
                <div className="h-8 w-24 rounded-full bg-surface-2" />
            </div>
            <div className="panel overflow-hidden">
                <div className="flex flex-col gap-3 p-card md:flex-row">
                    <div className="flex flex-1 items-center gap-3 md:gap-5">
                        <div className="h-16 w-16 rounded-full bg-surface-2 md:h-24 md:w-24" />
                        <div className="space-y-2">
                            <div className="h-7 w-56 rounded-chip bg-surface-2" />
                            <div className="h-3 w-32 rounded-chip bg-surface-2" />
                            <div className="h-9 w-48 rounded-chip bg-surface-2" />
                        </div>
                    </div>
                    <div className="h-[104px] rounded-[10px] bg-surface-2/60 md:w-[380px]" />
                </div>
                <div className="grid grid-cols-3 gap-2 px-card pb-card sm:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-[62px] rounded-[10px] bg-surface-2/60" />
                    ))}
                </div>
                <div className="h-32 border-t border-line" />
            </div>
            <div className="mt-4 h-9 w-80 max-w-full rounded-[10px] bg-surface-2" />
            <div className="mt-3 space-y-px">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-8 bg-surface-1" />
                ))}
            </div>
        </main>
    );
}
