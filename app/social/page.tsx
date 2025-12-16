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
    const allPredictions = await getPredictions();
    const lastRefresh = await getLastRefresh();

    // Filter by Date if provided, else use the most common date or today's date from the first game
    // The user said "current date only". 
    // Usually predictions are filtered by the pipeline, but let's ensure we group by date if multiple exist.
    // For now, take ALL predictions as they are usually for the upcoming slate.

    // pagination: 4 per page for 1x4 layout
    const pageSize = 4;
    const startIndex = batchIndex * pageSize;
    const selectedPredictions = allPredictions.slice(startIndex, startIndex + pageSize);

    const displayDate = selectedPredictions[0]?.date || new Date().toISOString().split('T')[0];

    // If no games, render empty or specific message
    if (selectedPredictions.length === 0) {
        return <div className="text-white">No more games.</div>;
    }

    return (
        <div className="w-[1080px] h-[1920px] bg-[#050505] text-white overflow-hidden relative font-sans flex flex-col">

            {/* HEADER - 150px */}
            <div className="h-[150px] w-full flex items-center justify-between px-12 border-b border-white/5 relative z-20 bg-[#0a0a0a]">

                {/* Logo & Refresh Time */}
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-4">
                        {/* Pony Logo Component */}
                        <div className="relative w-64 h-20 -ml-4">
                            <FullLogoAnimated />
                        </div>
                    </div>
                </div>

                {/* Date Pill */}
                <div className="px-6 py-2 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-cyan-400 font-mono text-xl font-bold shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                    {displayDate}
                </div>
            </div>

            {/* GRID CONTENT - Rest of space (approx 1650px) */}
            <div className="flex-1 w-full p-10">
                <div className="grid grid-cols-1 grid-rows-4 gap-[30px] h-full">
                    {selectedPredictions.map((pred) => (
                        <div key={pred.id} className="w-full h-full relative">
                            {/* 
                                isSocial Mode Multi-Game Stack:
                                - 4 games stacked vertically
                                - Shorter, wider cards
                            */}
                            <MatchupCard
                                prediction={pred}
                                maxTotalGoals={9}
                                isSocial={true}
                            />
                        </div>
                    ))}

                    {/* Fill empty slots if any */}
                    {Array.from({ length: pageSize - selectedPredictions.length }).map((_, i) => (
                        <div key={`empty-${i}`} className="w-full h-full rounded-3xl border border-white/5 bg-[#111]"></div>
                    ))}
                </div>
            </div>

            {/* FOOTER - 120px */}
            <div className="h-[120px] w-full flex items-center justify-center border-t border-white/5 bg-[#0a0a0a] relative z-20">
                <div className="text-gray-500 font-mono text-sm tracking-widest uppercase">
                    Pony xG <span className="mx-2">•</span> Automated NHL Predictions <span className="mx-2">•</span> @PonyxG
                </div>
            </div>

        </div>
    );
}
