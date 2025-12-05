import React from 'react';
import { getPredictions } from '@/utils/data';
import MatchupCard from '@/components/MatchupCard';

export default async function Home() {
    const predictions = await getPredictions();

    // Filter for the specific date if needed, or just show all.
    // The user mentioned "latest predicts detail data for today 2025-12-04".
    // The CSV has 2025-12-05. I will display what is in the CSV.
    // I'll group by date if there are multiple dates, or just show a header for the date.

    // Let's just take the first date found as the main date, or "2025-12-04" as requested.
    const displayDate = predictions.length > 0 ? predictions[0].date : '2025-12-04';

    return (
        <main className="min-h-screen bg-black text-white p-8 font-sans relative overflow-hidden">
            {/* Background Grid Lines */}
            <div className="absolute inset-0 pointer-events-none flex justify-center opacity-20">
                <div className="w-[1px] h-full bg-gray-500 mx-[250px]"></div>
                <div className="w-[1px] h-full bg-gray-500 mx-[250px]"></div>
            </div>

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header Section */}
                <div className="flex flex-col items-center mb-8">
                    {/* Legend / Header Labels */}
                    <div className="flex items-center gap-4 text-sm font-bold text-gray-300 mb-2 bg-gray-900/80 px-6 py-2 rounded-full border border-gray-700">
                        <span className="w-24 text-right">Away xG</span>
                        <span className="bg-green-500 text-black text-[10px] px-1 rounded">+EV%</span>
                        <div className="flex flex-col items-center mx-4">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Model Win%</span>
                            <span className="text-white text-lg">Total Goals</span>
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Vegas Win%</span>
                        </div>
                        <span className="bg-green-500 text-black text-[10px] px-1 rounded">+EV%</span>
                        <span className="w-24 text-left">Home xG</span>
                    </div>

                    <h1 className="text-4xl font-mono text-gray-200 tracking-widest mt-4">{displayDate}</h1>
                </div>

                {/* Matchups List */}
                <div className="flex flex-col gap-0">
                    {predictions.map((prediction) => (
                        <MatchupCard key={prediction.id} prediction={prediction} />
                    ))}
                </div>
            </div>
        </main>
    );
}
