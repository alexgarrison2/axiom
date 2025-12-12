import React from 'react';
import Link from 'next/link';
import { getHistory } from '@/utils/data';
import HistoryTable from '@/components/HistoryTable';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
    const history = await getHistory();

    // Calculate stats
    const totalGames = history.length;

    const correctPicks = history.filter(h => h.isCorrect).length;
    const accuracy = totalGames > 0 ? (correctPicks / totalGames) * 100 : 0;
    const avgBrier = totalGames > 0 ? history.reduce((sum, h) => sum + h.brierScore, 0) / totalGames : 0;

    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">

                {/* Header */}
                <div className="flex flex-col md:flex-row items-center justify-between mb-8 mt-4 gap-4">
                    <div className="flex flex-col">
                        <Link href="/" className="text-neutral-500 hover:text-white transition-colors text-sm font-mono mb-2">
                            &larr; Back to Predictions
                        </Link>
                        <h1 className="text-4xl font-black tracking-tighter uppercase relative">
                            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 animate-gradient-x">
                                Model History
                            </span>
                        </h1>
                    </div>

                    {/* Stats Cards */}
                    <div className="flex gap-4">
                        <div className="bg-white/5 border border-white/10 rounded-xl px-6 py-3 backdrop-blur-md">
                            <div className="text-xs text-neutral-400 uppercase tracking-widest">Accuracy</div>
                            <div className="text-2xl font-bold font-mono text-white">{accuracy.toFixed(1)}%</div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl px-6 py-3 backdrop-blur-md">
                            <div className="text-xs text-neutral-400 uppercase tracking-widest">Avg Brier</div>
                            <div className="text-2xl font-bold font-mono text-emerald-400">{avgBrier.toFixed(4)}</div>
                        </div>
                    </div>
                </div>

                <HistoryTable entries={history} />
            </div>
        </main>
    );
}
