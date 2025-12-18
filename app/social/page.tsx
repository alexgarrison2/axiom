import React from 'react';
import { getPredictions, getLastRefresh } from '@/utils/data';
import MatchupCard from '@/components/MatchupCard';
import FullLogoAnimated from '@/components/FullLogoAnimated';

// Force dynamic revalidation
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ batch?: string, date?: string }> }) {
    // Await searchParams in Next.js 15+ (if applicable, but safe to await)
    const params = await searchParams;
    const batchIndex = parseInt(params.batch || '0', 10);

    // Fetch Data
    const rawPredictions = await getPredictions();
    const lastRefresh = await getLastRefresh();

    // Filter to only include games for the first date available (TODAY only)
    const displayDate = rawPredictions[0]?.date || new Date().toISOString().split('T')[0];
    const allPredictions = rawPredictions.filter(p => p.date === displayDate);

    // Dynamic Grid Logic
    const gameCount = allPredictions.length;
    const columns = gameCount <= 10 ? 2 : 3;

    // Card dimensions and spacing
    const cardWidth = 377;
    const cardHeight = 162;
    const paddingH = 12;
    const paddingV = 20;

    // Layout dimensions
    const totalWidth = columns === 2 ? 790 : 1179;
    const rows = Math.ceil(gameCount / columns);
    const gridHeight = rows * (cardHeight + paddingV);
    const startY = 200;
    const totalHeight = startY + gridHeight + 100; // 100px for footer padding

    const startX = columns === 2 ? (790 - (2 * cardWidth + paddingH)) / 2 : 12;

    // pagination: up to 15 per page (or more if needed, but social usually wants one post)
    const pageSize = columns * 5; // 10 or 15
    const startIndex = batchIndex * pageSize;
    const selectedPredictions = allPredictions.slice(startIndex, startIndex + pageSize);

    // If no games, render empty or specific message
    if (selectedPredictions.length === 0) {
        return <div className="text-white">No more games.</div>;
    }

    return (
        <div
            id="social-capture-container"
            data-width={totalWidth}
            data-height={totalHeight}
            className="bg-[#020617] text-white overflow-hidden relative font-sans flex flex-col"
            style={{ width: `${totalWidth}px`, height: `${totalHeight}px` }}
        >

            {/* Header / Logo Section (Absolute to match example) */}
            <div className="absolute top-0 left-0 w-full flex flex-col items-center pt-4 pointer-events-none z-20">
                {/* Date Pill (Move to top, smaller) */}
                <div className="mb-2 px-6 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-400 font-mono text-lg font-bold shadow-[0_0_15px_rgba(6,182,212,0.15)] backdrop-blur-md">
                    {displayDate}
                </div>

                <div className="relative w-[380px] h-[100px]">
                    <FullLogoAnimated />
                </div>
                <div className="text-[10px] font-mono text-neutral-500 tracking-[0.4em] uppercase mt-1">
                    Last Refresh: {lastRefresh || 'DECEMBER 18, 12:25 PM'}
                </div>
            </div>

            {/* Game Cards Grid (Absolute Positioning) */}
            <div className="flex-1 w-full relative">
                {selectedPredictions.map((pred, index) => {
                    const row = Math.floor(index / columns);
                    const col = index % columns;
                    const x = startX + col * (cardWidth + paddingH);
                    const y = startY + row * (cardHeight + paddingV);

                    return (
                        <div
                            key={pred.id}
                            className="absolute"
                            style={{
                                left: `${x}px`,
                                top: `${y}px`,
                                width: `${cardWidth}px`,
                                height: `${cardHeight}px`
                            }}
                        >
                            <MatchupCard
                                prediction={pred}
                                maxTotalGoals={9}
                                isUltraCompact={true}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="absolute bottom-10 left-0 w-full flex items-center justify-center pointer-events-none">
                <div className="text-gray-600 font-mono text-[14px] tracking-widest uppercase">
                    <span className="text-blue-500 font-bold">Sources:</span> Bovada, DailyFaceoff, Hockey-Reference, api-web.nhle.com
                </div>
            </div>

        </div>
    );
}
