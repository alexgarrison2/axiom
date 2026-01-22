'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { HistoryEntry } from '../utils/data';

interface HistoryTableProps {
    entries: HistoryEntry[];
}

const HistoryTable: React.FC<HistoryTableProps> = ({ entries }) => {
    // State to track expanded dates (default empty = all collapsed)
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const toggleDate = (date: string) => {
        const newExpanded = new Set(expandedDates);
        if (newExpanded.has(date)) {
            newExpanded.delete(date);
        } else {
            newExpanded.add(date);
        }
        setExpandedDates(newExpanded);
    };

    // Group entries by date
    const groupedEntries = useMemo(() => {
        const groups: { [key: string]: HistoryEntry[] } = {};
        entries.forEach(entry => {
            if (!groups[entry.date]) groups[entry.date] = [];
            groups[entry.date].push(entry);
        });

        // Return as array sorted by date descending (newest first)
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [entries]);

    // Helper for Red-Yellow-Green gradient
    const getAccuracyColor = (percentage: number) => {
        // Hue: 0 (Red) -> 120 (Green)
        const hue = Math.min(120, Math.max(0, (percentage / 100) * 120));
        return `hsl(${hue}, 85%, 45%)`;
    };

    return (
        <div className="w-full max-w-6xl mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl">
            <div className="w-full">
                <table className="w-full text-left border-collapse table-fixed md:table-auto">
                    <thead>
                        <tr className="bg-white/5 border-b border-white/10 text-neutral-400 text-[10px] md:text-xs uppercase tracking-widest">
                            <th className="p-2 md:p-4 font-normal w-12 md:w-auto">Date</th>
                            <th className="p-2 md:p-4 font-normal w-20 md:w-auto">Matchup</th>
                            <th className="p-2 md:p-4 font-normal w-12 md:w-auto">Score</th>
                            <th className="p-2 md:p-4 font-normal text-center w-20 md:w-auto">
                                <span className="md:hidden">Pred</span>
                                <span className="hidden md:inline">xG Model</span>
                            </th>
                            <th className="p-2 md:p-4 font-normal text-center w-10 md:w-auto">Res</th>
                            <th className="p-2 md:p-4 font-normal text-right hidden md:table-cell">Brier</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {groupedEntries.map(([date, dayEntries]) => {
                            const correctCount = dayEntries.filter(e => e.isCorrect).length;
                            const wrongCount = dayEntries.length - correctCount;
                            const percentage = (correctCount / dayEntries.length) * 100;
                            const isExpanded = expandedDates.has(date);

                            // Parse date for display (prevent timezone rollback)
                            const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });

                            return (
                                <React.Fragment key={date}>
                                    {/* Summary Row */}
                                    <tr
                                        onClick={() => toggleDate(date)}
                                        className="cursor-pointer hover:bg-white/5 transition-colors bg-white/[0.02] border-b border-white/5"
                                    >
                                        <td colSpan={6} className="p-2 md:p-4">
                                            <div className="flex items-center justify-between w-full">
                                                {/* Left: Expand Icon + Date */}
                                                <div className="flex items-center gap-2">
                                                    <motion.div
                                                        animate={{ rotate: isExpanded ? 90 : 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="text-neutral-500 text-xs md:text-sm"
                                                    >
                                                        ▶
                                                    </motion.div>
                                                    <span className="text-xs md:text-sm font-bold text-white font-mono">
                                                        {displayDate}
                                                    </span>
                                                </div>

                                                {/* Right: Stats Summary */}
                                                <div className="flex items-center gap-2 md:gap-4">
                                                    <span className="font-mono text-xs md:text-sm">
                                                        <span className="text-emerald-400">{correctCount}</span>
                                                        <span className="text-neutral-600 mx-1">-</span>
                                                        <span className="text-red-400">{wrongCount}</span>
                                                    </span>
                                                    <div className="h-4 pl-2 md:pl-4 border-l border-white/10 flex items-center">
                                                        <span className="font-bold font-mono text-xs md:text-sm" style={{ color: getAccuracyColor(percentage) }}>
                                                            {percentage.toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    <span className="hidden md:inline text-neutral-500 ml-auto text-[10px] uppercase tracking-wider">
                                                        {dayEntries.length} Games
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* Expanded Details */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <>
                                                {dayEntries.map((entry) => {
                                                    // Result Logic
                                                    let hScore = entry.homeScore;
                                                    let aScore = entry.awayScore;
                                                    if (hScore === aScore && entry.actualWinner) {
                                                        if (entry.actualWinner === entry.homeTeam.commonName) hScore++;
                                                        else if (entry.actualWinner === entry.awayTeam.commonName) aScore++;
                                                    }

                                                    return (
                                                        <motion.tr
                                                            key={`${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            exit={{ opacity: 0 }}
                                                            transition={{ duration: 0.2 }}
                                                            className="hover:bg-white/[0.02] transition-colors bg-black/20"
                                                        >
                                                            {/* Empty Date Column for structure */}
                                                            <td className="p-2 md:p-4"></td>

                                                            {/* Matchup */}
                                                            <td className="p-2 md:p-4">
                                                                {/* Desktop View */}
                                                                <div className="hidden md:flex items-center gap-4">
                                                                    <div className="flex items-center gap-2 w-24 justify-end opacity-80">
                                                                        <span className="text-sm font-bold">{entry.awayTeam.triCode}</span>
                                                                        <div className="relative w-8 h-8">
                                                                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} fill className="object-contain" />
                                                                        </div>
                                                                    </div>
                                                                    <span className="text-neutral-600 text-xs">@</span>
                                                                    <div className="flex items-center gap-2 w-24 opacity-80">
                                                                        <div className="relative w-8 h-8">
                                                                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} fill className="object-contain" />
                                                                        </div>
                                                                        <span className="text-sm font-bold">{entry.homeTeam.triCode}</span>
                                                                    </div>
                                                                </div>

                                                                {/* Mobile View */}
                                                                <div className="flex flex-col gap-0.5 md:hidden">
                                                                    <div className="flex items-center gap-2 h-5">
                                                                        <span className="text-[10px] font-bold w-6">{entry.awayTeam.triCode}</span>
                                                                        <div className="relative w-5 h-5">
                                                                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} fill className="object-contain" />
                                                                        </div>
                                                                    </div>
                                                                    <div className="h-[10px] w-full invisible"></div>
                                                                    <div className="flex items-center gap-2 h-5">
                                                                        <span className="text-[10px] font-bold w-6">{entry.homeTeam.triCode}</span>
                                                                        <div className="relative w-5 h-5">
                                                                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} fill className="object-contain" />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            {/* Score */}
                                                            <td className="p-2 md:p-4 text-center font-mono text-[10px] md:text-sm whitespace-nowrap">
                                                                <span className="hidden md:inline">
                                                                    {aScore} - {hScore}
                                                                </span>
                                                                <div className="flex flex-col items-center md:hidden gap-0.5">
                                                                    <span className="h-5 flex items-center">{aScore}</span>
                                                                    <span className="text-neutral-600 text-[8px] leading-none h-[10px] flex items-center">-</span>
                                                                    <span className="h-5 flex items-center">{hScore}</span>
                                                                </div>
                                                            </td>

                                                            {/* Prediction */}
                                                            <td className="p-2 md:p-4 text-center">
                                                                <div className="hidden md:flex flex-col items-center">
                                                                    <span className="text-sm font-bold text-blue-400 whitespace-nowrap">
                                                                        {entry.awayXg.toFixed(2)} - {entry.homeXg.toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col items-center md:hidden gap-0.5">
                                                                    <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.awayXg.toFixed(2)}</span>
                                                                    <span className="invisible text-[8px] leading-none h-[10px] flex items-center">-</span>
                                                                    <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.homeXg.toFixed(2)}</span>
                                                                </div>
                                                            </td>

                                                            {/* Result */}
                                                            <td className="p-2 md:p-4 text-center">
                                                                <div className={`inline-flex items-center justify-center gap-1.5 px-1.5 py-1 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-bold border ${entry.isCorrect
                                                                    ? 'bg-emerald-500/10 md:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                                    : 'bg-red-500/10 md:bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                                                    {entry.isCorrect ? (
                                                                        <>
                                                                            <svg className="w-3 h-3 md:w-3 md:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                            </svg>
                                                                            <span className="hidden md:inline">CORRECT</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <svg className="w-3 h-3 md:w-3 md:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                                            </svg>
                                                                            <span className="hidden md:inline">WRONG</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            {/* Brier Score */}
                                                            <td className="p-2 md:p-4 text-right font-mono text-xs text-neutral-500 hidden md:table-cell">
                                                                {entry.brierScore.toFixed(4)}
                                                            </td>
                                                        </motion.tr>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </AnimatePresence>
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default HistoryTable;
