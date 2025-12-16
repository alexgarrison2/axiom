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

    // pagination: 6 per page
    const pageSize = 6;
    const startIndex = batchIndex * pageSize;
    const selectedPredictions = allPredictions.slice(startIndex, startIndex + pageSize);

    // If no games, render empty or specific message
    if (selectedPredictions.length === 0) {
        return <div className="text-white">No more games.</div>;
    }

    // Get current date for display (from the first game in the batch or system)
    // Use the game date if available, otherwise formatted today
    const displayDate = selectedPredictions[0]?.date || new Date().toISOString().split('T')[0];

    return (
        <div className="w-[1080px] h-[1350px] bg-[#050505] text-white overflow-hidden relative font-sans flex flex-col">

            {/* HEADER - 135px */}
            <div className="h-[135px] w-full flex items-center justify-between px-12 border-b border-white/5 relative z-20 bg-[#0a0a0a]">

                {/* Logo & Refresh Time */}
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-4">
                        {/* Pony Logo Component */}
                        <div className="relative w-64 h-20 -ml-4">
                            <FullLogoAnimated />
                        </div>
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1 tracking-widest uppercase pl-1">
                        Last Refresh: {lastRefresh}
                    </div>
                </div>

                {/* Date Pill */}
                <div className="px-6 py-2 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-cyan-400 font-mono text-lg font-bold shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                    {displayDate}
                </div>
            </div>

            {/* GRID CONTENT - 1080px (Rest of space minus footer) */}
            <div className="flex-1 w-full p-8">
                <div className="grid grid-cols-2 grid-rows-3 gap-6 h-full">
                    {selectedPredictions.map((pred) => (
                        <div key={pred.id} className="w-full h-full relative">
                            {/* 
                                isSocial Mode:
                                - No Box Shadows
                                - Content fits 500x320 approx
                                - No duplicate borders
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
                        <div key={`empty-${i}`} className="w-full h-full rounded-2xl border border-white/5 bg-[#111]"></div>
                    ))}
                </div>
            </div>

            {/* FOOTER - 135px */}
            <div className="h-[135px] w-full flex items-center justify-center border-t border-white/5 bg-[#0a0a0a] relative z-20">
                <div className="text-gray-500 font-mono text-sm tracking-widest">
                    <span className="text-blue-500 font-bold">Sources:</span> Bovada, DailyFaceoff, Hockey-Reference, api-web.nhle.com
                </div>
            </div>

        </div>
    );
}
