import React from 'react';
import Image from 'next/image';
import { getPredictions, getLastRefresh, getHistory } from '@/utils/data';
import { fetchRemainingSeason, fetchCurrentStandings } from '@/utils/schedule';
import PredictionsViewer from '@/components/PredictionsViewer';
import Header from '@/components/Header';

// Force dynamic revalidation to ensure data is fresh on every request
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function Home() {
    const predictions = await getPredictions();
    const history = await getHistory();
    const lastRefresh = await getLastRefresh();

    // Fetch Simulation Data (Parallel)
    const [fullSchedule, currentStandings] = await Promise.all([
        fetchRemainingSeason(),
        fetchCurrentStandings()
    ]);

    // Calculate max total goals for proportional sizing
    const maxTotalGoals = Math.max(...predictions.map(p => p.totalGoals), 6.5); // Default min 6.5

    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">
                {/* Header Section */}
                <Header lastRefresh={lastRefresh} />

                {/* Interactive Predictions Viewer */}
                <PredictionsViewer
                    predictions={predictions}
                    history={history}
                    maxTotalGoals={maxTotalGoals}
                    fullSchedule={fullSchedule}
                    currentStandings={currentStandings}
                />
            </div>
        </main>
    );
}
