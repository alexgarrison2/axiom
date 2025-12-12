'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { GamePrediction, HistoryEntry } from '@/utils/data';
import MatchupCard from './MatchupCard';
import HistoryTable from './HistoryTable';

interface PredictionsViewerProps {
    predictions: GamePrediction[];
    history: HistoryEntry[];
    maxTotalGoals: number;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 30, scale: 0.95 },
    show: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: 'spring', stiffness: 50, damping: 15 }
    },
    exit: {
        opacity: 0,
        scale: 0.9,
        transition: { duration: 0.2 }
    }
};

const PredictionsViewer: React.FC<PredictionsViewerProps> = ({ predictions, history, maxTotalGoals }) => {
    // Extract unique dates and sort them
    const uniqueDates = useMemo(() => {
        const dates = Array.from(new Set(predictions.map(p => p.date)));
        return dates.sort();
    }, [predictions]);

    // State for selected date
    // Default to the first date (Today)
    const [selectedTab, setSelectedTab] = useState<string>(uniqueDates[0] || 'History');

    // Filter predictions for the selected date
    const filteredPredictions = useMemo(() => {
        if (selectedTab === 'History') return [];
        return predictions.filter(p => p.date === selectedTab);
    }, [predictions, selectedTab]);

    if (uniqueDates.length === 0 && history.length === 0) {
        return <div className="text-center text-gray-500 mt-12 font-mono uppercase tracking-widest animate-pulse">No data available.</div>;
    }

    return (
        <div className="w-full">
            {/* Controls Container */}
            <div className="flex flex-col items-center mb-12 gap-8">

                {/* Controls Row */}
                <div className="flex items-center gap-8 flex-wrap justify-center w-full relative z-20">

                    {/* Date Selector */}
                    <div className="flex items-center gap-4 flex-wrap justify-center bg-black/40 p-2 rounded-full backdrop-blur-md border border-white/5">

                        {/* History Button */}
                        <button
                            onClick={() => setSelectedTab('History')}
                            className={`relative px-6 py-2 rounded-full font-bold text-sm tracking-wider transition-all duration-300 border ${selectedTab === 'History'
                                ? 'text-amber-400 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.3)] text-glow-amber'
                                : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {selectedTab === 'History' && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-amber-400/10 rounded-full"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <span className="relative z-10">HISTORY</span>
                        </button>

                        {/* Date Buttons */}
                        {uniqueDates.map(date => (
                            <button
                                key={date}
                                onClick={() => setSelectedTab(date)}
                                className={`relative px-6 py-2 rounded-full font-bold text-sm tracking-wider transition-all duration-300 border ${selectedTab === date
                                    ? 'text-neon-blue border-neon-blue shadow-[0_0_20px_rgba(0,243,255,0.3)] text-glow-blue'
                                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {selectedTab === date && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute inset-0 bg-neon-blue/10 rounded-full"
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">{date}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            {selectedTab === 'History' ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="w-full"
                >
                    {/* Stats Header for History inside the tab? */}
                    {/* Let's replicate the stats header from the old history page just for context, or keep it simple table? 
                         User didn't ask for stats header removal, but keeping it inside the tab view is nice.
                         Actually, let's keep it simple and just show the table as requested.
                     */}

                    <HistoryTable entries={history} />
                </motion.div>
            ) : (
                /* Grid Layout - Staggered Fade In */
                <motion.div
                    className="grid grid-cols-1 xl:grid-cols-2 gap-8 w-full pb-24"
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    key={selectedTab} // Re-trigger animation on date change
                >
                    <AnimatePresence mode="wait">
                        {filteredPredictions.map((prediction) => (
                            <motion.div
                                key={prediction.id}
                                variants={itemVariants}
                                layout
                            >
                                <MatchupCard prediction={prediction} maxTotalGoals={maxTotalGoals} />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </motion.div>
            )}
        </div>
    );
};

export default PredictionsViewer;

