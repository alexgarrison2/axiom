'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { HistoryEntry } from '../utils/data';

interface HistoryTableProps {
    entries: HistoryEntry[];
    viewMode?: 'date' | 'team';
    pickFilter?: 'win' | 'loss' | null;
}

// Red → Yellow → Green based on accuracy %
const getAccuracyColor = (pct: number) => {
    const hue = Math.min(120, Math.max(0, (pct / 100) * 120));
    return `hsl(${hue}, 85%, 45%)`;
};

// Shared game row used by both views
const GameRow: React.FC<{
    entry: HistoryEntry;
    showDate?: boolean;
}> = ({ entry, showDate = false }) => {
    let hScore = entry.homeScore;
    let aScore = entry.awayScore;
    if (hScore === aScore && entry.actualWinner) {
        if (entry.actualWinner === entry.homeTeam.commonName) hScore++;
        else if (entry.actualWinner === entry.awayTeam.commonName) aScore++;
    }

    const displayDate = new Date(`${entry.date}T12:00:00`).toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit',
    });

    return (
        <motion.tr
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hover:bg-white/[0.02] transition-colors bg-black/20"
        >
            {/* Date column — shows date in team view, empty in date view */}
            <td className="p-2 md:p-4">
                {showDate && (
                    <span className="text-[10px] md:text-xs font-mono text-neutral-500">{displayDate}</span>
                )}
            </td>

            {/* Matchup */}
            <td className="p-2 md:p-4">
                {/* Desktop */}
                <div className="hidden md:flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 justify-end opacity-80">
                        <span className="text-sm font-bold">{entry.awayTeam.triCode}</span>
                        <div className="relative w-8 h-8">
                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.triCode} fill className="object-contain" />
                        </div>
                    </div>
                    <span className="text-neutral-600 text-xs">@</span>
                    <div className="flex items-center gap-2 w-24 opacity-80">
                        <div className="relative w-8 h-8">
                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.triCode} fill className="object-contain" />
                        </div>
                        <span className="text-sm font-bold">{entry.homeTeam.triCode}</span>
                    </div>
                </div>
                {/* Mobile */}
                <div className="flex flex-col gap-0.5 md:hidden">
                    <div className="flex items-center gap-2 h-5">
                        <span className="text-[10px] font-bold w-6">{entry.awayTeam.triCode}</span>
                        <div className="relative w-5 h-5">
                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.triCode} fill className="object-contain" />
                        </div>
                    </div>
                    <div className="h-[10px] w-full invisible" />
                    <div className="flex items-center gap-2 h-5">
                        <span className="text-[10px] font-bold w-6">{entry.homeTeam.triCode}</span>
                        <div className="relative w-5 h-5">
                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.triCode} fill className="object-contain" />
                        </div>
                    </div>
                </div>
            </td>

            {/* Score */}
            <td className="p-2 md:p-4 text-center font-mono text-[10px] md:text-sm whitespace-nowrap">
                <span className="hidden md:inline">{aScore} - {hScore}</span>
                <div className="flex flex-col items-center md:hidden gap-0.5">
                    <span className="h-5 flex items-center">{aScore}</span>
                    <span className="text-neutral-600 text-[8px] leading-none h-[10px] flex items-center">-</span>
                    <span className="h-5 flex items-center">{hScore}</span>
                </div>
            </td>

            {/* xG Prediction */}
            <td className="p-2 md:p-4 text-center">
                <div className="hidden md:flex flex-col items-center">
                    <span className="text-sm font-bold text-blue-400 whitespace-nowrap">
                        {entry.awayXg.toFixed(2)} - {entry.homeXg.toFixed(2)}
                    </span>
                </div>
                <div className="flex flex-col items-center md:hidden gap-0.5">
                    <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.awayXg.toFixed(2)}</span>
                    <span className="invisible text-[8px] h-[10px] flex items-center">-</span>
                    <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.homeXg.toFixed(2)}</span>
                </div>
            </td>

            {/* Result */}
            <td className="p-2 md:p-4 text-center">
                <div className={`inline-flex items-center justify-center gap-1.5 px-1.5 py-1 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-bold border ${
                    entry.isCorrect
                        ? 'bg-emerald-500/10 md:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-red-500/10 md:bg-red-500/20 text-red-400 border-red-500/30'
                }`}>
                    {entry.isCorrect ? (
                        <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="hidden md:inline">CORRECT</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
};

// ─── By Date View ─────────────────────────────────────────────────────────────

const ByDateView: React.FC<{ entries: HistoryEntry[] }> = ({ entries }) => {
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const toggle = (key: string) => {
        const next = new Set(expandedDates);
        next.has(key) ? next.delete(key) : next.add(key);
        setExpandedDates(next);
    };

    const grouped = useMemo(() => {
        const groups: Record<string, HistoryEntry[]> = {};
        entries.forEach(e => {
            if (!groups[e.date]) groups[e.date] = [];
            groups[e.date].push(e);
        });
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [entries]);

    return (
        <>
            {grouped.map(([date, dayEntries]) => {
                const correct = dayEntries.filter(e => e.isCorrect).length;
                const wrong   = dayEntries.length - correct;
                const pct     = (correct / dayEntries.length) * 100;
                const isExp   = expandedDates.has(date);
                const display = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });

                return (
                    <React.Fragment key={date}>
                        {/* Group header */}
                        <tr
                            onClick={() => toggle(date)}
                            className="cursor-pointer hover:bg-white/5 transition-colors bg-white/[0.02] border-b border-white/5"
                        >
                            <td colSpan={6} className="p-2 md:p-4">
                                <div className="flex items-center justify-between w-full">
                                    <div className="flex items-center gap-2">
                                        <motion.div
                                            animate={{ rotate: isExp ? 90 : 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="text-neutral-500 text-xs md:text-sm"
                                        >▶</motion.div>
                                        <span className="text-xs md:text-sm font-bold text-white font-mono">{display}</span>
                                        {!isExp && (
                                            <div className="flex items-center gap-1.5 ml-2">
                                                {dayEntries.slice(0, 4).map((entry, idx) => (
                                                    <div key={idx} className="flex items-center gap-0.5 opacity-60">
                                                        <div className="relative w-4 h-4 md:w-5 md:h-5">
                                                            <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.triCode} fill className="object-contain" />
                                                        </div>
                                                        <span className="text-neutral-600 text-[7px] md:text-[8px]">@</span>
                                                        <div className="relative w-4 h-4 md:w-5 md:h-5">
                                                            <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.triCode} fill className="object-contain" />
                                                        </div>
                                                        {idx < Math.min(dayEntries.length, 4) - 1 && (
                                                            <span className="text-neutral-700 text-[8px] ml-0.5 hidden md:inline">·</span>
                                                        )}
                                                    </div>
                                                ))}
                                                {dayEntries.length > 4 && (
                                                    <span className="text-neutral-600 text-[9px] font-mono ml-1">+{dayEntries.length - 4}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 md:gap-4">
                                        <span className="font-mono text-xs md:text-sm">
                                            <span className="text-emerald-400">{correct}</span>
                                            <span className="text-neutral-600 mx-1">-</span>
                                            <span className="text-red-400">{wrong}</span>
                                        </span>
                                        <div className="h-4 pl-2 md:pl-4 border-l border-white/10 flex items-center">
                                            <span className="font-bold font-mono text-xs md:text-sm" style={{ color: getAccuracyColor(pct) }}>
                                                {pct.toFixed(0)}%
                                            </span>
                                        </div>
                                        <span className="hidden md:inline text-neutral-500 text-[10px] uppercase tracking-wider">
                                            {dayEntries.length} Games
                                        </span>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        <AnimatePresence>
                            {isExp && dayEntries.map(entry => (
                                <GameRow
                                    key={`${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`}
                                    entry={entry}
                                    showDate={false}
                                />
                            ))}
                        </AnimatePresence>
                    </React.Fragment>
                );
            })}
        </>
    );
};

// ─── By Team View ─────────────────────────────────────────────────────────────

// Returns true if `teamTriCode` was the team we picked to win in this game
function wasPickedToWin(entry: HistoryEntry, teamTriCode: string): boolean {
    const pw = entry.predictedWinner;
    const isHomePicked = pw === entry.homeTeam.commonName || pw === entry.homeTeam.name;
    return (isHomePicked ? entry.homeTeam.triCode : entry.awayTeam.triCode) === teamTriCode;
}

const ByTeamView: React.FC<{ entries: HistoryEntry[]; pickFilter?: 'win' | 'loss' | null }> = ({ entries, pickFilter }) => {
    const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

    const toggle = (key: string) => {
        const next = new Set(expandedTeams);
        next.has(key) ? next.delete(key) : next.add(key);
        setExpandedTeams(next);
    };

    // Build team groups: each game goes under both teams
    const grouped = useMemo(() => {
        const groups = new Map<string, { logoUrl: string; triCode: string; name: string; entries: HistoryEntry[] }>();

        entries.forEach(entry => {
            const addTo = (triCode: string, logoUrl: string, name: string) => {
                if (!groups.has(triCode)) {
                    groups.set(triCode, { logoUrl, triCode, name, entries: [] });
                }
                groups.get(triCode)!.entries.push(entry);
            };
            addTo(entry.homeTeam.triCode, entry.homeTeam.logoUrl, entry.homeTeam.commonName || entry.homeTeam.name);
            addTo(entry.awayTeam.triCode, entry.awayTeam.logoUrl, entry.awayTeam.commonName || entry.awayTeam.name);
        });

        // Sort entries within each team: newest first
        groups.forEach(g => g.entries.sort((a, b) => b.date.localeCompare(a.date)));

        // Sort teams alphabetically by triCode
        return Array.from(groups.values()).sort((a, b) => a.triCode.localeCompare(b.triCode));
    }, [entries]);

    return (
        <>
            {grouped.map(({ triCode, logoUrl, entries: teamEntries }) => {
                // Apply pick direction filter per-team
                const visibleEntries = pickFilter === 'win'
                    ? teamEntries.filter(e => wasPickedToWin(e, triCode))
                    : pickFilter === 'loss'
                    ? teamEntries.filter(e => !wasPickedToWin(e, triCode))
                    : teamEntries;

                // Hide team rows that have no matching games under the current filter
                if (visibleEntries.length === 0) return null;

                const correct = visibleEntries.filter(e => e.isCorrect).length;
                const wrong   = visibleEntries.length - correct;
                const pct     = (correct / visibleEntries.length) * 100;
                const isExp   = expandedTeams.has(triCode);

                // Last 8 results as mini dots (newest → oldest, left → right)
                const recentResults = visibleEntries.slice(0, 8);

                return (
                    <React.Fragment key={triCode}>
                        {/* Team header row */}
                        <tr
                            onClick={() => toggle(triCode)}
                            className="cursor-pointer hover:bg-white/5 transition-colors bg-white/[0.02] border-b border-white/5"
                        >
                            <td colSpan={6} className="p-2 md:p-4">
                                <div className="flex items-center justify-between w-full">

                                    {/* Left: expand icon + logo + tricode */}
                                    <div className="flex items-center gap-2 md:gap-3">
                                        <motion.div
                                            animate={{ rotate: isExp ? 90 : 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="text-neutral-500 text-xs md:text-sm flex-shrink-0"
                                        >▶</motion.div>

                                        <div className="relative w-7 h-7 md:w-9 md:h-9 flex-shrink-0">
                                            <Image src={logoUrl} alt={triCode} fill className="object-contain" />
                                        </div>

                                        <span className="text-xs md:text-sm font-black text-white tracking-wide">
                                            {triCode}
                                        </span>

                                        {/* Recent form dots (hidden when expanded) */}
                                        {!isExp && (
                                            <div className="flex items-center gap-1 ml-1 md:ml-2">
                                                {recentResults.map((e, i) => (
                                                    <div
                                                        key={i}
                                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                                        style={{ backgroundColor: e.isCorrect ? '#34d399' : '#f87171', opacity: 1 - i * 0.09 }}
                                                        title={e.isCorrect ? 'Correct' : 'Wrong'}
                                                    />
                                                ))}
                                                {visibleEntries.length > 8 && (
                                                    <span className="text-neutral-600 text-[9px] font-mono ml-0.5">
                                                        +{visibleEntries.length - 8}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: W-L · Accuracy · Game count */}
                                    <div className="flex items-center gap-2 md:gap-4">
                                        <span className="font-mono text-xs md:text-sm">
                                            <span className="text-emerald-400">{correct}</span>
                                            <span className="text-neutral-600 mx-1">-</span>
                                            <span className="text-red-400">{wrong}</span>
                                        </span>
                                        <div className="h-4 pl-2 md:pl-4 border-l border-white/10 flex items-center">
                                            <span className="font-bold font-mono text-xs md:text-sm" style={{ color: getAccuracyColor(pct) }}>
                                                {pct.toFixed(0)}%
                                            </span>
                                        </div>
                                        <span className="hidden md:inline text-neutral-500 text-[10px] uppercase tracking-wider">
                                            {visibleEntries.length} Games
                                        </span>
                                    </div>
                                </div>
                            </td>
                        </tr>

                        {/* Expanded game rows — show date since team is already the grouping key */}
                        <AnimatePresence>
                            {isExp && visibleEntries.map(entry => (
                                <GameRow
                                    key={`${triCode}-${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`}
                                    entry={entry}
                                    showDate
                                />
                            ))}
                        </AnimatePresence>
                    </React.Fragment>
                );
            })}
        </>
    );
};

// ─── Main component ────────────────────────────────────────────────────────────

const HistoryTable: React.FC<HistoryTableProps> = ({ entries, viewMode = 'date', pickFilter }) => {
    return (
        <div className="w-full max-w-6xl mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl">
            <div className="w-full">
                <table className="w-full text-left border-collapse table-fixed md:table-auto">
                    <thead>
                        <tr className="bg-white/5 border-b border-white/10 text-neutral-400 text-[10px] md:text-xs uppercase tracking-widest">
                            <th className="p-2 md:p-4 font-normal w-12 md:w-auto">
                                {viewMode === 'team' ? 'Date' : 'Date'}
                            </th>
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
                        {viewMode === 'team'
                            ? <ByTeamView entries={entries} pickFilter={pickFilter} />
                            : <ByDateView entries={entries} />
                        }
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default HistoryTable;
