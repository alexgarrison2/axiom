'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { GamePrediction, HistoryEntry } from '@/utils/data';
import MatchupCard from './MatchupCard';
import HistoryTable from './HistoryTable';
import TeamsTable from './TeamsTable';
import NewsSection from './NewsSection';

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

const PredictionsViewer: React.FC<PredictionsViewerProps> = ({ predictions: initialPredictions, history, maxTotalGoals }) => {
    const [predictions, setPredictions] = useState<GamePrediction[]>(initialPredictions);

    // Sync Predictions with live News
    React.useEffect(() => {
        const fetchNews = async () => {
            try {
                const res = await fetch('/data/player_news.json');
                const newsData = await res.json();

                const updated = initialPredictions.map(p => {
                    let newHomeStatus = p.homeGoalieStatus;
                    let newAwayStatus = p.awayGoalieStatus;

                    const checkOverride = (teamAbbr: string, currentStatus: string, expectedStarter: string) => {
                        if (currentStatus !== 'Unconfirmed' || !expectedStarter) return currentStatus;

                        const teamNews = newsData[teamAbbr] || [];
                        const starterNews = teamNews.find((n: any) =>
                            n.category === 'Goalie Start' &&
                            (n.player.includes(expectedStarter) || expectedStarter.includes(n.player))
                        );
                        return starterNews ? 'Confirmed' : currentStatus;
                    };

                    if (p.homeTeamAbbrev) newHomeStatus = checkOverride(p.homeTeamAbbrev, p.homeGoalieStatus || 'Unconfirmed', p.homeGoalieConfirmed || '');
                    if (p.awayTeamAbbrev) newAwayStatus = checkOverride(p.awayTeamAbbrev, p.awayGoalieStatus || 'Unconfirmed', p.awayGoalieConfirmed || '');

                    if (newHomeStatus !== p.homeGoalieStatus || newAwayStatus !== p.awayGoalieStatus) {
                        return {
                            ...p,
                            homeGoalieStatus: newHomeStatus,
                            awayGoalieStatus: newAwayStatus
                        };
                    }
                    return p;
                });

                setPredictions(updated);
            } catch (e) {
                console.error("Failed to sync news overrides:", e);
            }
        };
        fetchNews();
    }, [initialPredictions]);

    // Extract unique dates and sort them
    const uniqueDates = useMemo(() => {
        const dates = Array.from(new Set(predictions.map(p => p.date)));
        return dates.sort();
    }, [predictions]);


    // State for selected date
    // Default to the first date (Today)
    const [selectedTab, setSelectedTab] = useState<string>(uniqueDates[0] || 'History');
    // Multi-select state: Default to ['All']
    const [historyFilters, setHistoryFilters] = useState<string[]>(['All']);

    // Filter predictions for the selected date
    const filteredPredictions = useMemo(() => {
        if (selectedTab === 'History' || selectedTab === 'Teams' || selectedTab === 'News') return [];
        return predictions.filter(p => p.date === selectedTab);
    }, [predictions, selectedTab]);

    // Filter history based on model confidence
    const filteredHistory = useMemo(() => {
        if (historyFilters.includes('All') || historyFilters.length === 0) return history;

        return history.filter(h => {
            // Determine the model's win probability for the predicted winner
            const isHome = h.predictedWinner === h.homeTeam.commonName || h.predictedWinner === h.homeTeam.name;
            const modelConf = isHome ? h.homeWinProb : (100 - h.homeWinProb);

            // Check against enabled filters
            if (historyFilters.includes('50-55') && (modelConf >= 50 && modelConf < 55)) return true;
            if (historyFilters.includes('55-65') && (modelConf >= 55 && modelConf < 65)) return true;
            if (historyFilters.includes('65-75') && (modelConf >= 65 && modelConf < 75)) return true;
            if (historyFilters.includes('75+') && (modelConf >= 75)) return true;

            return false;
        });
    }, [history, historyFilters]);

    if (uniqueDates.length === 0 && history.length === 0) {
        return <div className="text-center text-gray-500 mt-12 font-mono uppercase tracking-widest animate-pulse">No data available.</div>;
    }

    return (
        <div className="w-full">
            {/* Controls Container */}
            <div className="flex flex-col items-center mb-12 gap-8">

                {/* Controls Row */}
                <div className="flex items-center justify-center w-full relative z-20 max-w-full">
                    {/* Date Selector */}
                    <div className="grid grid-cols-6 items-center gap-2 md:gap-3 bg-black/40 p-1.5 md:p-2.5 rounded-2xl md:rounded-3xl backdrop-blur-md border border-white/5 w-auto max-w-full overflow-hidden">
                        {/* History Button */}
                        <button
                            onClick={() => setSelectedTab('History')}
                            className={`relative px-3 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 col-span-2 ${selectedTab === 'History'
                                ? 'text-neon-green border-neon-green shadow-[0_0_20px_rgba(10,255,0,0.3)] text-glow-green'
                                : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {selectedTab === 'History' && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-neon-green/10 rounded-full"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <span className="relative z-10">HISTORY</span>
                        </button>

                        {/* Teams Button */}
                        <button
                            onClick={() => setSelectedTab('Teams')}
                            className={`relative px-3 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 col-span-2 ${selectedTab === 'Teams'
                                ? 'text-purple-400 border-purple-400 shadow-[0_0_20_rgba(168,85,247,0.3)] text-glow-purple'
                                : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {selectedTab === 'Teams' && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-purple-400/10 rounded-full"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <span className="relative z-10">TEAMS</span>
                        </button>

                        {/* News Button */}
                        <button
                            onClick={() => setSelectedTab('News')}
                            className={`relative px-3 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 col-span-2 ${selectedTab === 'News'
                                ? 'text-amber-400 border-amber-400 shadow-[0_0_20_rgba(251,191,36,0.3)] text-glow-amber'
                                : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {selectedTab === 'News' && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-amber-400/10 rounded-full"
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <span className="relative z-10">NEWS</span>
                        </button>

                        {/* Date Buttons */}
                        {uniqueDates.map(date => (
                            <button
                                key={date}
                                onClick={() => setSelectedTab(date)}
                                className={`relative px-3 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 col-span-3 ${selectedTab === date
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
                    {/* History Filters */}
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                        {(['All', '50-55', '55-65', '65-75', '75+'] as const).map((filter) => {
                            const isActive = historyFilters.includes(filter);
                            return (
                                <button
                                    key={filter}
                                    onClick={() => {
                                        if (filter === 'All') {
                                            setHistoryFilters(['All']);
                                        } else {
                                            let newFilters = historyFilters.filter(f => f !== 'All'); // Remove All if specific selected
                                            if (newFilters.includes(filter)) {
                                                newFilters = newFilters.filter(f => f !== filter);
                                            } else {
                                                newFilters.push(filter);
                                            }
                                            // If nothing selected, revert to All
                                            if (newFilters.length === 0) newFilters = ['All'];
                                            setHistoryFilters(newFilters);
                                        }
                                    }}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-full border transition-all ${isActive
                                        ? 'bg-neon-green/10 text-neon-green border-neon-green shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                                        : 'bg-white/5 text-neutral-400 border-white/5 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    {filter === 'All' ? 'ALL GAMES' : `${filter}%`}
                                </button>
                            );
                        })}
                    </div>

                    {/* Aggregate Stats Header */}
                    <div className="grid grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-8">
                        {(() => {
                            // Use filteredHistory for stats
                            const statsHistory = filteredHistory;
                            const totalGames = statsHistory.length;
                            const correctPicks = statsHistory.filter(h => h.isCorrect).length;
                            const accuracy = totalGames > 0 ? ((correctPicks / totalGames) * 100).toFixed(1) : '0.0';

                            // Average Brier Score
                            const avgBrier = totalGames > 0
                                ? (statsHistory.reduce((acc, curr) => acc + curr.brierScore, 0) / totalGames).toFixed(4)
                                : '0.0000';

                            // Log Loss Calculation
                            const logLossSum = statsHistory.reduce((acc, curr) => {
                                const p = Math.max(0.0001, Math.min(0.9999, curr.homeWinProb / 100)); // Convert % to Prob & Clip
                                const y = curr.actualWinner === curr.homeTeam.commonName ? 1 : 0;
                                return acc + (y * Math.log(p) + (1 - y) * Math.log(1 - p));
                            }, 0);
                            const avgLogLoss = totalGames > 0 ? (-1 * (logLossSum / totalGames)).toFixed(4) : '0.0000';

                            return (
                                <>
                                    {/* Accuracy Card */}
                                    <div className="glass-panel p-2 md:p-6 rounded-xl md:rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                                        <span className="text-gray-400 text-[8px] md:text-xs font-mono uppercase tracking-widest mb-1 md:mb-2 z-10 text-center">
                                            <span className="md:hidden">Accuracy</span>
                                            <span className="hidden md:inline">Model Accuracy</span>
                                        </span>
                                        <div className="text-lg md:text-4xl font-bold text-white z-10 text-glow-green">
                                            {accuracy}%
                                        </div>
                                        <div className="text-emerald-400/60 text-[8px] md:text-xs mt-0.5 md:mt-1 font-mono text-center leading-tight">
                                            {correctPicks}/{totalGames} <span className="hidden md:inline">Correct</span>
                                        </div>
                                    </div>

                                    {/* Brier Score Card */}
                                    <div className="glass-panel p-2 md:p-6 rounded-xl md:rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                                        <span className="text-gray-400 text-[8px] md:text-xs font-mono uppercase tracking-widest mb-1 md:mb-2 z-10 text-center">
                                            <span className="md:hidden">Brier</span>
                                            <span className="hidden md:inline">Avg Brier Score</span>
                                        </span>
                                        <div className="text-lg md:text-4xl font-bold text-white z-10 text-glow-blue">
                                            {avgBrier}
                                        </div>
                                        <div className="text-blue-400/60 text-[8px] md:text-xs mt-0.5 md:mt-1 font-mono text-center leading-tight">
                                            <span className="md:hidden">Lower=Best</span>
                                            <span className="hidden md:inline">Lower is Better</span>
                                        </div>
                                    </div>

                                    {/* Log Loss Card */}
                                    <div className="glass-panel p-2 md:p-6 rounded-xl md:rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                                        <span className="text-gray-400 text-[8px] md:text-xs font-mono uppercase tracking-widest mb-1 md:mb-2 z-10 text-center">
                                            Log Loss
                                        </span>
                                        <div className="text-lg md:text-4xl font-bold text-white z-10 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                                            {avgLogLoss}
                                        </div>
                                        <div className="text-purple-400/60 text-[8px] md:text-xs mt-0.5 md:mt-1 font-mono text-center leading-tight">
                                            <span className="md:hidden">Prob Error</span>
                                            <span className="hidden md:inline">Probabilistic Error</span>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    <HistoryTable entries={filteredHistory} />
                </motion.div>
            ) : selectedTab === 'Teams' ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="w-full"
                >
                    <TeamsTable />
                </motion.div>
            ) : selectedTab === 'News' ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="w-full"
                >
                    <NewsSection predictions={predictions} />
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

