import React from 'react';
import Image from 'next/image';
import { getPredictions, getLastRefresh } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';
import FullLogoAnimated from '@/components/FullLogoAnimated';

// Force dynamic revalidation to ensure data is fresh on every request
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function Home() {
    const predictions = await getPredictions();
    const lastRefresh = await getLastRefresh();

    // Calculate max total goals for proportional sizing
    const maxTotalGoals = Math.max(...predictions.map(p => p.totalGoals), 6.5); // Default min 6.5

    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">
                {/* Header Section */}
                <div className="flex flex-col items-center justify-center mb-12 mt-8">
                    <div className="w-full max-w-[340px] md:max-w-[600px] h-auto">
                        <FullLogoAnimated />
                    </div>
                    {/* Last Refresh Text */}
                    <div className="text-neutral-500 text-xs md:text-sm font-mono tracking-widest uppercase mt-4 opacity-80">
                        Last Refresh: {lastRefresh}
                    </div>
                </div>

                {/* Interactive Predictions Viewer */}
                <PredictionsViewer predictions={predictions} maxTotalGoals={maxTotalGoals} />
            </div>
        </main>
    );
}
