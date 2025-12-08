'use client';

import React, { useState, useMemo } from 'react';
import { GamePrediction } from '@/utils/data';
import MatchupCard from './MatchupCard';
import Legend from './Legend';

interface PredictionsViewerProps {
    predictions: GamePrediction[];
    maxTotalGoals: number;
}

const PredictionsViewer: React.FC<PredictionsViewerProps> = ({ predictions, maxTotalGoals }) => {
    // Extract unique dates and sort them
    const uniqueDates = useMemo(() => {
        const dates = Array.from(new Set(predictions.map(p => p.date)));
        return dates.sort();
    }, [predictions]);

    // State for selected date
    const [selectedDate, setSelectedDate] = useState<string>(uniqueDates[0] || '');
    // State for legend visibility
    const [showLegend, setShowLegend] = useState(false);

    // Filter predictions for the selected date
    const filteredPredictions = useMemo(() => {
        return predictions.filter(p => p.date === selectedDate);
    }, [predictions, selectedDate]);

    if (uniqueDates.length === 0) {
        return <div className="text-center text-gray-500 mt-12 font-mono uppercase tracking-widest animate-pulse">No predictions available.</div>;
    }

    return (
        <div className="w-full">
            {/* Controls Container */}
            <div className="flex flex-col items-center mb-12 gap-8">

                {/* Controls Row */}
                <div className="flex items-center gap-8 flex-wrap justify-center w-full relative z-20">

                    {/* Date Selector & Legend Toggle */}
                    <div className="flex items-center gap-4 flex-wrap justify-center bg-black/40 p-2 rounded-full backdrop-blur-md border border-white/5">
                        {uniqueDates.map(date => (
                            <button
                                key={date}
                                onClick={() => setSelectedDate(date)}
                                className={`px-6 py-2 rounded-full font-bold text-sm tracking-wider transition-all duration-300 border ${selectedDate === date
                                    ? 'bg-neon-blue/10 text-neon-blue border-neon-blue shadow-[0_0_20px_rgba(0,243,255,0.3)] text-glow-blue'
                                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {date}
                            </button>
                        ))}

                        <div className="w-[1px] h-8 bg-white/10 mx-2"></div>

                        <button
                            onClick={() => setShowLegend(!showLegend)}
                            className={`px-6 py-2 rounded-full font-bold text-sm tracking-wider transition-all duration-300 border ${showLegend
                                ? 'bg-neon-green/10 text-neon-green border-neon-green shadow-[0_0_20px_rgba(10,255,0,0.3)] text-glow-green'
                                : 'bg-transparent text-gray-400 border-transparent hover:text-white hover:bg-white/5'
                                }`}
                        >
                            HOW TO READ {showLegend ? '▲' : '▼'}
                        </button>
                    </div>
                </div>

                {/* Collapsible Legend */}
                <div className={`w-full transition-all duration-500 ease-in-out overflow-hidden ${showLegend ? 'max-h-[600px] opacity-100 mb-8' : 'max-h-0 opacity-0'}`}>
                    <Legend />
                </div>


            </div>

            {/* Grid Layout - Staggered Fade In */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 w-full animate-fade-in-up pb-24">
                {filteredPredictions.map((prediction, index) => (
                    <div key={prediction.id} style={{ animationDelay: `${index * 50}ms` }} className="animate-fade-in-up fill-mode-backwards">
                        <MatchupCard prediction={prediction} maxTotalGoals={maxTotalGoals} />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PredictionsViewer;
