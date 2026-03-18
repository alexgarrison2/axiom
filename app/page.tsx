import React from 'react';
import { getPredictions, getLastRefresh, getHistory } from '@/utils/data';
import { fetchRemainingSeason, fetchCurrentStandings } from '@/utils/schedule';
import { getGameImplications } from '@/utils/implications-server';
import PredictionsViewer from '@/components/PredictionsViewer';

// Force dynamic revalidation to ensure data is fresh on every request
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function Home() {
    const predictions = await getPredictions();
    const history = await getHistory();
    const lastRefresh = await getLastRefresh();

    // Fetch Simulation Data + Implications (Parallel)
    const [fullSchedule, currentStandings, implicationsData] = await Promise.all([
        fetchRemainingSeason(),
        fetchCurrentStandings(),
        getGameImplications(),
    ]);

    return (
        <main className="min-h-screen bg-black text-white px-3 py-2 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">

            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-[1800px] mx-auto relative z-10">
                {/* Interactive Predictions Viewer */}
                <PredictionsViewer
                    predictions={predictions}
                    history={history}
                    fullSchedule={fullSchedule}
                    currentStandings={currentStandings}
                    lastRefresh={lastRefresh}
                    implicationsData={implicationsData}
                />
            </div>
        </main>
    );
}
