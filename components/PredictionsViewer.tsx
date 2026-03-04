'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { GamePrediction, HistoryEntry } from '@/utils/data';
import { SimGame } from '@/utils/schedule';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import MatchupCard from './MatchupCard';
import HistoryTable from './HistoryTable';
import TeamsTable from './TeamsTable';
import NewsSection from './NewsSection';
import PlayoffTable from './PlayoffTable';
import PlayoffBracket from './PlayoffBracket';
import SkaterStatsTable from './SkaterStatsTable';
import Header from './Header';
import { Slider } from '@/components/ui/slider';

interface PredictionsViewerProps {
    predictions: GamePrediction[];
    history: HistoryEntry[];
    fullSchedule: SimGame[];
    currentStandings: TeamStandings[];
    lastRefresh?: string;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.15, // Increased stagger for better wave effect
            delayChildren: 0.2
        }
    }
};

const itemVariants: Variants = {
    hidden: {
        opacity: 0,
        y: 100, // Slide up from further down
        scale: 0.9,
        filter: 'blur(10px)' // Add blur on entry
    },
    show: {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        transition: {
            type: 'spring',
            stiffness: 70,
            damping: 18,
            mass: 1.2
        }
    },
    exit: {
        opacity: 0,
        scale: 0.9,
        filter: 'blur(10px)',
        transition: { duration: 0.3 }
    }
};

const PredictionsViewer: React.FC<PredictionsViewerProps> = ({ predictions: initialPredictions, history, fullSchedule, currentStandings, lastRefresh }) => {
    const [predictions, setPredictions] = useState<GamePrediction[]>(initialPredictions);
    const [simResults, setSimResults] = useState<Record<string, SimResult>>({});
    const workerRef = useRef<Worker | null>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const handleTabScroll = useCallback(() => {
        const el = tabBarRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 5);
        setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 5);
    }, []);

    // Check initial scroll state
    useEffect(() => {
        // Small delay to let tabs render
        const timer = setTimeout(handleTabScroll, 200);
        return () => clearTimeout(timer);
    }, [handleTabScroll]);

    // Load Season Projections from Backend (JSON)
    useEffect(() => {
        const fetchProjections = async () => {
            try {
                const res = await fetch(`/data/season_projections.json?t=${new Date().getTime()}`);
                if (!res.ok) throw new Error("No projection file");

                const data = await res.json();
                const processedResults: Record<string, SimResult> = {};

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data.forEach((row: any) => {
                    // Reverse-engineer SimResult from percentages
                    // We treat percentages as "counts out of 100" for simplicity
                    // or "counts out of 1000" for decimals. 
                    // Let's use 10,000 to keep precision (e.g. 0.1%)
                    const totalSims = 2000; // Matches Python script count

                    // Parse Maps from JSON objects
                    const pointDist = new Map<number, number>();
                    if (row.point_dist) {
                        Object.entries(row.point_dist).forEach(([pt, count]) => pointDist.set(Number(pt), Number(count)));
                    }

                    const divRankDist = new Map<number, number>();
                    if (row.div_rank_dist) {
                        Object.entries(row.div_rank_dist).forEach(([rank, count]) => divRankDist.set(Number(rank), Number(count)));
                    }

                    processedResults[row.team] = {
                        madePlayoffs: Math.round((row.make_playoffs_pct / 100) * totalSims),
                        wonDivision: Math.round((row.won_division_pct / 100) * totalSims),
                        wonCup: Math.round((row.won_cup_pct / 100) * totalSims),
                        totalSims: totalSims,
                        totalPoints: row.avg_points * totalSims,

                        pointDist: pointDist,
                        divRankDist: divRankDist,
                        roundExitDist: row.round_exit_dist || { 'MISS': 0, 'R1': 0, 'R2': 0, 'CF': 0, 'F': 0, 'CUP': 0 },
                        r1Matchups: row.r1_matchups || {}
                    };
                });

                setSimResults(processedResults);
            } catch (err) {
                console.warn("Could not load Season Projections, falling back to Worker?", err);
                // Fallback logic could go here, or we simple leave it empty/loading
            }
        };

        fetchProjections();
    }, []);

    // Worker Disabled in favor of Backend Projections
    /*
    useEffect(() => {
        if (!fullSchedule || fullSchedule.length === 0 || !currentStandings || currentStandings.length === 0) return;

        // Initialize Worker
        if (!workerRef.current) {
            workerRef.current = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url));
        }

        const worker = workerRef.current;

        // Listen for results
        worker.onmessage = (e) => {
            if (e.data.type === 'SIMULATION_COMPLETE') {
                const results: Record<string, SimResult> = e.data.results;
                setSimResults(results); // Store full results for table
            }
        };

        // Fire off the base simulation
        worker.postMessage({
            type: 'RUN_SIMULATION',
            schedule: fullSchedule,
            standings: currentStandings,
            iterations: 5000 // Run 5k to keep it fast
        });

        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, [fullSchedule, currentStandings, predictions]); */

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
                        const starterNews = teamNews.find((n: { category: string; player: string }) =>
                            n.category === 'Goalie Start' &&
                            (n.player.includes(expectedStarter) || expectedStarter.includes(n.player))
                        );
                        return starterNews ? 'Confirmed' : currentStatus;
                    };

                    if (p.homeTeam?.triCode) newHomeStatus = checkOverride(p.homeTeam.triCode, p.homeGoalieStatus || 'Unconfirmed', p.homeGoalieConfirmed || '');
                    if (p.awayTeam?.triCode) newAwayStatus = checkOverride(p.awayTeam.triCode, p.awayGoalieStatus || 'Unconfirmed', p.awayGoalieConfirmed || '');

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
    // Default to 'Today' if available, else first date
    // Or simpler: default to first date in list which is usually "today" or "tomorrow"
    const [selectedTab, setSelectedTab] = useState<string>(uniqueDates[0] || 'History');
    // Multi-select state: Default to ['All']
    const [historyFilters, setHistoryFilters] = useState<string[]>(['All']);
    // History view mode: 'date' (default) or 'team'
    const [historyViewMode, setHistoryViewMode] = useState<'date' | 'team'>('date');
    // Secondary pick filter (only relevant in team view)
    const [historyPickFilter, setHistoryPickFilter] = useState<'win' | 'loss' | null>(null);

    // History Date Range Logic
    const uniqueHistoryDates = useMemo(() => {
        const dates = Array.from(new Set(history.map(h => h.date))).sort();
        return dates;
    }, [history]);

    const [dateRange, setDateRange] = useState<number[]>([0, 0]);

    // Initialize range when data loads — default start to 2026-01-18
    useEffect(() => {
        if (uniqueHistoryDates.length > 0) {
            const defaultStart = uniqueHistoryDates.indexOf('2026-01-18');
            setDateRange([defaultStart >= 0 ? defaultStart : 0, uniqueHistoryDates.length - 1]);
        }
    }, [uniqueHistoryDates]);

    // Filter predictions for the selected date
    const filteredPredictions = useMemo(() => {
        if (selectedTab === 'History' || selectedTab === 'Teams' || selectedTab === 'News' || selectedTab === 'Playoffs' || selectedTab === 'Bracket' || selectedTab === 'Skaters') return [];
        return predictions.filter(p => p.date === selectedTab);
    }, [predictions, selectedTab]);

    // Filter history based on date range and model confidence
    const filteredHistory = useMemo(() => {
        let filtered = history;

        // 1. Date Range Filter
        if (uniqueHistoryDates.length > 0) {
            const startDate = uniqueHistoryDates[dateRange[0]];
            const endDate = uniqueHistoryDates[dateRange[1]];
            filtered = filtered.filter(h => h.date >= startDate && h.date <= endDate);
        }

        // 2. Confidence Filters
        if (historyFilters.includes('All') || historyFilters.length === 0) return filtered;

        return filtered.filter(h => {
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
    }, [history, historyFilters, dateRange, uniqueHistoryDates]);

    if (uniqueDates.length === 0 && history.length === 0) {
        return <div className="text-center text-gray-500 mt-12 font-mono uppercase tracking-widest animate-pulse">No data available.</div>;
    }

    const isMainPage = !['News', 'Teams', 'History', 'Playoffs', 'Bracket', 'Skaters'].includes(selectedTab);

    return (
        <div className="w-full">
            {/* Header Section (Only on Main Prediction Pages) */}
            {isMainPage && <Header lastRefresh={lastRefresh} />}

            {/* Controls Container */}
            <div className={`flex flex-col items-center gap-8 relative z-20 ${isMainPage ? 'mb-12' : 'mb-6 mt-6 md:mt-8'}`}>

                {/* Controls Row */}
                <div className="flex items-center justify-center w-full relative z-20 max-w-full">
                    {/* Tab bar container with fade hints */}
                    <div className="relative w-full max-w-full">
                        {/* Left fade */}
                        <div
                            className={`absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black/90 to-transparent z-10 pointer-events-none transition-opacity duration-300 md:hidden ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {/* Right fade */}
                        <div
                            className={`absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black/90 to-transparent z-10 pointer-events-none transition-opacity duration-300 md:hidden ${canScrollRight ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {/* Date Selector */}
                        <div
                            ref={tabBarRef}
                            onScroll={handleTabScroll}
                            className="flex items-center gap-2 md:gap-3 bg-black/40 p-1.5 md:p-2.5 rounded-2xl md:rounded-3xl backdrop-blur-md border border-white/5 w-full max-w-full overflow-x-auto snap-x scrollbar-hide px-2 md:px-4">

                            {/* Text Logo for non-main pages */}
                            {!isMainPage && (
                                <div className="flex-shrink-0 flex items-center pr-3 md:pr-4 border-r border-white/10 mr-1 md:mr-2 snap-start">
                                    <Image src="/ponyxG_condensed.png" alt="pony xG" width={80} height={24} className="h-4 md:h-5 w-auto object-contain drop-shadow-[0_0_8px_rgba(0,243,255,0.8)]" />
                                </div>
                            )}

                            {/* Date Buttons — TODAY / TOMORROW first */}
                            {uniqueDates.map((date, idx) => {
                                const [y, m, d] = date.split('-').map(Number);
                                const dateObj = new Date(y, m - 1, d);
                                const monthShort = dateObj.toLocaleDateString('en-US', { month: 'short' });
                                const dayStr = String(d).padStart(2, '0');
                                const label = `${monthShort}-${dayStr}`;
                                return (
                                    <button
                                        key={date}
                                        onClick={() => setSelectedTab(date)}
                                        className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start whitespace-nowrap ${selectedTab === date
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
                                        <span className="relative z-10">{label}</span>
                                    </button>
                                );
                            })}

                            {/* News Button */}
                            <button
                                onClick={() => setSelectedTab('News')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'News'
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

                            {/* Teams Button */}
                            <button
                                onClick={() => setSelectedTab('Teams')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'Teams'
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

                            {/* History Button */}
                            <button
                                onClick={() => setSelectedTab('History')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'History'
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

                            {/* Playoffs Button */}
                            <button
                                onClick={() => setSelectedTab('Playoffs')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'Playoffs'
                                    ? 'text-rose-400 border-rose-400 shadow-[0_0_20_rgba(244,63,94,0.3)] text-glow-rose'
                                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {selectedTab === 'Playoffs' && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute inset-0 bg-rose-400/10 rounded-full"
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">PLAYOFFS</span>
                            </button>

                            {/* Bracket Button */}
                            <button
                                onClick={() => setSelectedTab('Bracket')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'Bracket'
                                    ? 'text-sky-400 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.3)]'
                                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {selectedTab === 'Bracket' && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute inset-0 bg-sky-400/10 rounded-full"
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">BRACKET</span>
                            </button>

                            {/* Skaters Button */}
                            <button
                                onClick={() => setSelectedTab('Skaters')}
                                className={`relative px-4 md:px-6 py-2 rounded-full font-bold text-[10px] md:text-sm tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${selectedTab === 'Skaters'
                                    ? 'text-cyan-400 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.3)]'
                                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {selectedTab === 'Skaters' && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute inset-0 bg-cyan-400/10 rounded-full"
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">SKATERS</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <AnimatePresence mode="wait">
                {selectedTab === 'History' ? (
                    <motion.div
                        key="tab-history"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        {/* History Filters & Slider */}
                        <div className="flex flex-col items-center gap-4 mb-4 max-w-2xl mx-auto">

                            {/* View Toggle: By Date / By Team */}
                            <div className="flex items-center gap-2 flex-wrap justify-center">
                                <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/8">
                                    {(['date', 'team'] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => {
                                                setHistoryViewMode(mode);
                                                if (mode === 'date') setHistoryPickFilter(null);
                                            }}
                                            className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${historyViewMode === mode
                                                    ? 'bg-white/10 text-white shadow-sm'
                                                    : 'text-neutral-500 hover:text-neutral-300'
                                                }`}
                                        >
                                            {mode === 'date' ? 'By Date' : 'By Team'}
                                        </button>
                                    ))}
                                </div>

                                {/* Secondary: Pick direction filter — team mode only */}
                                {historyViewMode === 'team' && (
                                    <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/8">
                                        {([null, 'win', 'loss'] as const).map((f) => (
                                            <button
                                                key={String(f)}
                                                onClick={() => setHistoryPickFilter(f)}
                                                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${historyPickFilter === f
                                                        ? 'bg-white/10 text-white shadow-sm'
                                                        : 'text-neutral-500 hover:text-neutral-300'
                                                    }`}
                                            >
                                                {f === null ? 'All Picks' : f === 'win' ? 'Picked to Win' : 'Picked to Lose'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Date Range Slider */}
                            {uniqueHistoryDates.length > 1 && (
                                <div className="w-full px-4 md:px-0">
                                    <div className="flex justify-between text-xs md:text-sm text-neutral-400 mb-2 font-mono">
                                        <span>{uniqueHistoryDates[dateRange[0]]}</span>
                                        <span className="text-white/50">DATE RANGE</span>
                                        <span>{uniqueHistoryDates[dateRange[1]]}</span>
                                    </div>
                                    <Slider
                                        defaultValue={[0, uniqueHistoryDates.length - 1]}
                                        value={dateRange}
                                        min={0}
                                        max={uniqueHistoryDates.length - 1}
                                        step={1}
                                        onValueChange={setDateRange}
                                        className="py-4"
                                    />
                                </div>
                            )}

                            <div className="flex flex-wrap justify-center gap-2">
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
                                                {correctPicks}-{totalGames - correctPicks} <span className="hidden md:inline">Record</span>
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

                        <HistoryTable entries={filteredHistory} viewMode={historyViewMode} pickFilter={historyPickFilter} />
                    </motion.div>
                ) : selectedTab === 'Teams' ? (
                    <motion.div
                        key="tab-teams"
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
                        key="tab-news"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        <NewsSection predictions={predictions} />
                    </motion.div>
                ) : selectedTab === 'Playoffs' ? (
                    <motion.div
                        key="tab-playoffs"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        <div className="max-w-7xl mx-auto">
                            <div className="text-center mb-4">
                                <h2 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-rose-400 to-orange-400 mb-1">Playoff Probability Dashboard</h2>
                                <p className="text-neutral-400 text-xs md:text-sm">Monte Carlo simulations (5,000 runs). Projected points are averaged outcomes.</p>
                            </div>
                            {Object.keys(simResults).length > 0 ? (
                                <PlayoffTable currentStandings={currentStandings} simResults={simResults} />
                            ) : (
                                <div className="flex justify-center items-center py-24">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-500"></div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : selectedTab === 'Bracket' ? (
                    <motion.div
                        key="tab-bracket"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        <div className="w-full">
                            {Object.keys(simResults).length > 0 ? (
                                <PlayoffBracket currentStandings={currentStandings} simResults={simResults} />
                            ) : (
                                <div className="flex justify-center items-center py-24">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500" />
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : selectedTab === 'Skaters' ? (
                    <motion.div
                        key="tab-skaters"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        <SkaterStatsTable />
                    </motion.div>
                ) : (
                    /* Grid Layout - Staggered Fade In */
                    <motion.div
                        className="grid grid-cols-1 xl:grid-cols-2 gap-8 w-full pb-24"
                        variants={containerVariants}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0 }}
                        key={`tab-date-${selectedTab}`} // Re-trigger animation on date change
                    >
                        {filteredPredictions.map((prediction) => (
                            <motion.div
                                key={prediction.id}
                                variants={itemVariants}
                                layout
                                whileHover={{ scale: 1.02, transition: { type: "spring", stiffness: 400, damping: 10 } }}
                            >
                                <MatchupCard
                                    prediction={prediction}
                                />
                            </motion.div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PredictionsViewer;
