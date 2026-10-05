/** Game page skeleton: score band, then the pulse strip, at their real heights. */
export default function Loading() {
    return (
        <main aria-busy="true" className="page pb-tabbar pt-3 md:pt-5">
            <div className="h-[172px] animate-pulse rounded-card border border-line bg-surface-1/60 md:h-[236px]" />
            <div className="mt-5 h-[500px] animate-pulse rounded-card border border-line bg-surface-1/60 md:h-[690px] lg:ml-[10.5rem]" />
        </main>
    );
}
