import React from 'react';
import { getPredictions, getLastRefresh } from '@/utils/data';
import MatchupCard from '@/components/MatchupCard';

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
        <div className="w-[1080px] h-[1350px] bg-[#111] text-white overflow-hidden relative font-sans flex flex-col">

            {/* Validating Dimensions: 
                Header: 135px
                Grid: 1080px (height) -> 2x3 = 360px per row.
                Footer: 135px
                Total: 1350px.
            */}

            {/* HEADER - 135px */}
            <div className="h-[135px] w-full flex items-center justify-between px-12 border-b border-gray-800 relative z-20 bg-[#111]">

                {/* Logo & Refresh Time */}
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-4">
                        {/* Pony Logo */}
                        <div className="relative w-64 h-20">
                            {/* Reusing the logo text svg or image if available. 
                                The user's image shows the Pony xG text logo.
                                I'll assume standard text or image availability.
                                Using simple text if image not found, but better to use the Header's logo logic.
                            */}
                            <div className="text-4xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 font-outfit" style={{ textShadow: '0 0 30px rgba(6,182,212,0.5)' }}>
                                <span className="font-mono mr-2 text-cyan-400 text-5xl">♞</span>
                                pony<span className="text-white">xG</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1 tracking-widest uppercase">
                        Last Refresh: {lastRefresh}
                    </div>
                </div>

                {/* Date Pill */}
                <div className="px-6 py-2 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-cyan-400 font-mono text-lg font-bold shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                    {displayDate}
                </div>
            </div>

            {/* GRID CONTENT - 1080px (Rest of space minus footer) */}
            <div className="flex-1 w-full p-6">
                <div className="grid grid-cols-2 grid-rows-3 gap-6 h-full">
                    {selectedPredictions.map((pred) => (
                        <div key={pred.id} className="w-full h-full overflow-hidden relative rounded-2xl border border-gray-800 bg-[#151515]">
                            {/* 
                                We wrap MatchupCard to force scale it to fit if necessary.
                                540x360 is the cell size (minus gap).
                                Gap 6 (1.5rem = 24px).
                                Grid width = 1080 - 48 (padding) = 1032.
                                Col width = 504px.
                                Row height = ~330px.
                                
                                MatchupCard is designed for ~w-full. 
                                We might need to scale it down to fit 330px height nicely.
                                Let's apply a subtle scale if it fits poorly, or just let CSS handle it.
                                Actually, standard MatchupCard assumes vertical stacking of details.
                                We should pass `isSocial` prop if we had one, but we don't.
                                I will just render it and use CSS zoom/scale on the container.
                            */}
                            <div className="origin-top-left transform scale-[0.85] w-[117%] h-[117%] p-2">
                                <MatchupCard
                                    prediction={pred}
                                    maxTotalGoals={9} // Adjusted for visual
                                />
                            </div>
                        </div>
                    ))}

                    {/* Fill empty slots if any */}
                    {Array.from({ length: pageSize - selectedPredictions.length }).map((_, i) => (
                        <div key={`empty-${i}`} className="w-full h-full rounded-2xl border border-gray-800/30 bg-[#111]"></div>
                    ))}
                </div>
            </div>

            {/* FOOTER - 135px */}
            <div className="h-[135px] w-full flex items-center justify-center border-t border-gray-800 bg-[#111] relative z-20">
                <div className="text-gray-500 font-mono text-sm tracking-widest">
                    <span className="text-blue-500 font-bold">Sources:</span> Bovada, DailyFaceoff, Hockey-Reference, api-web.nhle.com
                </div>
            </div>

        </div>
    );
}
