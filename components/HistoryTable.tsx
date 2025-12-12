import React from 'react';
import Image from 'next/image';
import { HistoryEntry } from '../utils/data';

interface HistoryTableProps {
    entries: HistoryEntry[];
}

const HistoryTable: React.FC<HistoryTableProps> = ({ entries }) => {
    return (
        <div className="w-full max-w-6xl mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl">
            <div className="w-full">
                <table className="w-full text-left border-collapse table-fixed md:table-auto">
                    <thead>
                        <tr className="bg-white/5 border-b border-white/10 text-neutral-400 text-[10px] md:text-xs uppercase tracking-widest">
                            <th className="p-2 md:p-4 font-normal w-12 md:w-auto">Date</th>
                            <th className="p-2 md:p-4 font-normal w-20 md:w-auto">Matchup</th>
                            <th className="p-2 md:p-4 font-normal text-center w-12 md:w-auto">Score</th>
                            <th className="p-2 md:p-4 font-normal text-center w-20 md:w-auto">Pred</th>
                            <th className="p-2 md:p-4 font-normal text-center w-10 md:w-auto">Res</th>
                            <th className="p-2 md:p-4 font-normal text-right hidden md:table-cell">Brier</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {entries.map((entry, idx) => (
                            <tr
                                key={`${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`}
                                className="hover:bg-white/[0.02] transition-colors"
                            >
                                {/* Date */}
                                <td className="p-2 md:p-4 text-[10px] md:text-sm font-mono text-neutral-400">
                                    {new Date(entry.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}
                                </td>

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

                                    {/* Mobile View - Stacked Custom Layout */}
                                    <div className="flex flex-col gap-0.5 md:hidden">
                                        <div className="flex items-center gap-2 h-5">
                                            <span className="text-[10px] font-bold w-6">{entry.awayTeam.triCode}</span>
                                            <div className="relative w-5 h-5">
                                                <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} fill className="object-contain" />
                                            </div>
                                        </div>
                                        {/* Spacer to align with Score hyphen */}
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
                                    {/* Desktop */}
                                    <span className="hidden md:inline">
                                        {entry.awayScore} - {entry.homeScore}
                                    </span>
                                    {/* Mobile Stack */}
                                    <div className="flex flex-col items-center md:hidden gap-0.5">
                                        <span className="h-5 flex items-center">{entry.awayScore}</span>
                                        <span className="text-neutral-600 text-[8px] leading-none h-[10px] flex items-center">-</span>
                                        <span className="h-5 flex items-center">{entry.homeScore}</span>
                                    </div>
                                </td>

                                {/* Prediction */}
                                <td className="p-2 md:p-4 text-center">
                                    {/* Desktop */}
                                    <div className="hidden md:flex flex-col items-center">
                                        <span className="text-sm font-bold text-blue-400 whitespace-nowrap">
                                            {entry.awayXg.toFixed(1)} - {entry.homeXg.toFixed(1)}
                                        </span>
                                        <span className="text-[10px] text-neutral-500">xG Model</span>
                                    </div>
                                    {/* Mobile Stack aligned with scores */}
                                    <div className="flex flex-col items-center md:hidden gap-0.5">
                                        <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.awayXg.toFixed(1)}</span>
                                        <span className="invisible text-[8px] leading-none h-[10px] flex items-center">-</span>
                                        <span className="text-blue-400 font-bold text-[10px] h-5 flex items-center">{entry.homeXg.toFixed(1)}</span>
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
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default HistoryTable;
