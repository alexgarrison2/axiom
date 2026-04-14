import React from 'react';
import MatchupCard from '@/components/MatchupCard';
import { getHistory, getPredictions } from '@/utils/data';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function FigmaMatchupCardPage() {
    const [predictions, history] = await Promise.all([
        getPredictions(),
        getHistory(),
    ]);

    const prediction = predictions[0];

    if (!prediction) {
        return (
            <main className="min-h-screen bg-black text-white grid place-items-center p-8">
                <div className="text-sm font-mono uppercase tracking-[0.3em] text-neutral-500">
                    No matchup card data available.
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[#020617] text-white grid place-items-center p-10">
            <div
                id="matchup-card-capture"
                className="w-full max-w-[720px] rounded-[32px] border border-cyan-500/15 bg-black/30 p-6 shadow-[0_40px_120px_rgba(8,145,178,0.18)] backdrop-blur-sm"
            >
                <MatchupCard prediction={prediction} history={history} />
            </div>
        </main>
    );
}
