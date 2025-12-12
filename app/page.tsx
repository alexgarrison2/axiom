import React from 'react';
import Image from 'next/image';
import { getPredictions, getLastRefresh, getHistory } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';
import FullLogoAnimated from '@/components/FullLogoAnimated';

// Force dynamic revalidation to ensure data is fresh on every request
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function Home() {
    const predictions = await getPredictions();
    const history = await getHistory();
    const lastRefresh = await getLastRefresh();

    // Calculate max total goals for proportional sizing
    const maxTotalGoals = Math.max(...predictions.map(p => p.totalGoals), 6.5); // Default min 6.5

    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">
                {/* Header Section */}
                <div className="flex flex-col items-center justify-center mb-12 mt-8 relative">
                    {/* About Button - Absolute Top Right relative to Header Container */}
                    <a
                        href="/about-the-model"
                        className="absolute right-0 top-0 hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 group"
                    >
                        <span className="text-xs font-mono tracking-widest text-neutral-400 group-hover:text-white transition-colors">MODEL CONTEXT</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-neon-blue shadow-[0_0_8px_rgba(0,243,255,0.8)] animate-pulse"></div>
                    </a>

                    {/* Mobile Only About Link (Simple) */}
                    <a
                        href="/about-the-model"
                        className="md:hidden absolute right-0 top-0 p-2 text-neutral-500 hover:text-white"
                    >
                        <span className="sr-only">About</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                    </a>

                    <div className="w-full max-w-[340px] md:max-w-[600px] h-auto">
                        <FullLogoAnimated />
                    </div>
                    {/* Last Refresh Text */}
                    <div className="text-neutral-500 text-xs md:text-sm font-mono tracking-widest uppercase mt-4 opacity-80">
                        Last Refresh: {lastRefresh}
                    </div>
                </div>

                {/* Interactive Predictions Viewer */}
                <PredictionsViewer
                    predictions={predictions}
                    history={history}
                    maxTotalGoals={maxTotalGoals}
                />
            </div>
        </main>
    );
}
