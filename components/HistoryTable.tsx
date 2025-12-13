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
                            <th className="p-2 md:p-4 font-normal w-24 md:w-32">Date</th>
                            <th className="p-2 md:p-4 font-normal w-auto">Summary / Matchup</th>
                            <th className="p-2 md:p-4 font-normal text-right w-20 md:w-24">Accuracy</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {groupedEntries.map(([date, dayEntries]) => {
                            const correctCount = dayEntries.filter(e => e.isCorrect).length;
                            const wrongCount = dayEntries.length - correctCount;
                            const percentage = (correctCount / dayEntries.length) * 100;
                            const isExpanded = expandedDates.has(date);

                            // Parse date for display (prevent timezone rollback)
                            const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                            return (
                                <React.Fragment key={date}>
                                    {/* Summary Row */}
                                    <tr
                                        onClick={() => toggleDate(date)}
                                        className="cursor-pointer hover:bg-white/5 transition-colors bg-white/[0.02] border-b border-white/5"
                                    >
                                        <td className="p-2 md:p-4 text-xs md:text-sm font-bold text-white font-mono flex items-center gap-2">
                                            <motion.div
                                                animate={{ rotate: isExpanded ? 90 : 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="text-neutral-500"
                                            >
                                                ▶
                                            </motion.div>
                                            {displayDate}
                                        </td>
                                        <td className="p-2 md:p-4 text-xs md:text-sm text-neutral-300">
                                            <span className="font-mono">
                                                <span className="text-emerald-400">{correctCount}</span>
                                                <span className="text-neutral-600 mx-1">-</span>
                                                <span className="text-red-400">{wrongCount}</span>
                                            </span>
                                            <span className="hidden md:inline text-neutral-500 ml-2 text-[10px] uppercase tracking-wider">
                                                ({dayEntries.length} Games)
                                            </span>
                                        </td>
                                        <td className="p-2 md:p-4 text-right font-bold text-xs md:text-sm" style={{ color: getAccuracyColor(percentage) }}>
                                            {percentage.toFixed(0)}%
                                        </td>
                                    </tr>

                                    {/* Expanded Details */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={3} className="p-0 border-none">
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.3, ease: "easeInOut" }}
                                                        className="overflow-hidden bg-black/20"
                                                    >
                                                        <table className="w-full">
                                                            <tbody className="divide-y divide-white/5 border-b border-white/5">
                                                                {dayEntries.map((entry) => {
                                                                    // Result Logic
                                                                    let hScore = entry.homeScore;
                                                                    let aScore = entry.awayScore;
                                                                    if (hScore === aScore && entry.actualWinner) {
                                                                        if (entry.actualWinner === entry.homeTeam.commonName) hScore++;
                                                                        else if (entry.actualWinner === entry.awayTeam.commonName) aScore++;
                                                                    }

                                                                    return (
                                                                        <tr key={`${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`} className="hover:bg-white/[0.02]">
                                                                            {/* Spacer / Indent */}
                                                                            <td className="w-4 md:w-8"></td>

                                                                            {/* Matchup */}
                                                                            <td className="p-2 md:p-3 w-full">
                                                                                <div className="flex items-center gap-2 md:gap-4">
                                                                                    {/* Desktop Matchup */}
                                                                                    <div className="hidden md:flex items-center gap-3">
                                                                                        <div className="flex items-center gap-2 w-20 justify-end opacity-80">
                                                                                            <span className="text-xs font-bold text-neutral-400">{entry.awayTeam.triCode}</span>
                                                                                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} width={24} height={24} className="object-contain" />
                                                                                        </div>
                                                                                        <span className="text-neutral-700 text-[10px]">@</span>
                                                                                        <div className="flex items-center gap-2 w-20 opacity-80">
                                                                                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} width={24} height={24} className="object-contain" />
                                                                                            <span className="text-xs font-bold text-neutral-400">{entry.homeTeam.triCode}</span>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Mobile Matchup */}
                                                                                    <div className="flex md:hidden items-center gap-2">
                                                                                        <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} width={20} height={20} className="object-contain" />
                                                                                        <span className="text-[10px] text-neutral-500">v</span>
                                                                                        <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} width={20} height={20} className="object-contain" />
                                                                                    </div>

                                                                                    {/* Score */}
                                                                                    <div className="font-mono text-xs text-white/90 whitespace-nowrap ml-2 md:ml-4">
                                                                                        {aScore}-{hScore}
                                                                                    </div>

                                                                                    {/* xG */}
                                                                                    <div className="hidden md:block text-[10px] text-blue-400 font-mono ml-4">
                                                                                        xG: {entry.awayXg.toFixed(1)}-{entry.homeXg.toFixed(1)}
                                                                                    </div>

                                                                                    {/* Result Badge */}
                                                                                    <div className={`ml-auto inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${entry.isCorrect
                                                                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                                                                        : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                                                                                        {entry.isCorrect ? 'CORRECT' : 'WRONG'}
                                                                                    </div>
                                                                                </div>
                                                                            </td>

                                                                            {/* Brier/Extra */}
                                                                            <td className="hidden md:table-cell p-2 md:p-3 text-right font-mono text-[10px] text-neutral-600 w-24">
                                                                                Brier: {entry.brierScore.toFixed(3)}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </motion.div>
                                                </td>
                                            </tr>
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
