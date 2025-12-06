import React from 'react';
import Image from 'next/image';
import { getPredictions } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';

// Revalidate data every 60 seconds (Incremental Static Regeneration)
export const revalidate = 60;

export default async function Home() {
    const predictions = await getPredictions();

    // Calculate max total goals for proportional sizing
    const maxTotalGoals = Math.max(...predictions.map(p => p.totalGoals), 6.5); // Default min 6.5

    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">
                {/* Header Section */}
                <div className="flex flex-row items-center justify-center mb-12 mt-8 gap-2 md:gap-6">
                    <div className="relative w-16 h-16 md:w-24 md:h-24 shrink-0">
                        <Image
                            src="/logo_vector.png"
                            alt="Pony xG Logo"
                            fill
                            className="object-contain drop-shadow-[0_0_15px_rgba(0,243,255,0.4)]"
                            priority
                        />
                    </div>
                    <h1 className="text-5xl md:text-9xl font-[family-name:var(--font-neonderthaw)] tracking-wide drop-shadow-[0_0_15px_rgba(0,243,255,0.6)] py-4 px-2 leading-relaxed animate-shine-flow whitespace-nowrap">
                        Pony xG
                    </h1>
                </div>

                {/* Interactive Predictions Viewer */}
                <PredictionsViewer predictions={predictions} maxTotalGoals={maxTotalGoals} />
            </div>
        </main>
    );
}
