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
                                    <div className="flex flex-col md:flex-row items-center gap-1 md:gap-4">
                                        {/* Away */}
                                        <div className="flex items-center gap-1 md:gap-2 w-auto md:w-24 justify-start md:justify-end opacity-80">
                                            <div className="relative w-5 h-5 md:w-8 md:h-8 order-2 md:order-2">
                                                <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} fill className="object-contain" />
                                            </div>
                                            <span className="text-[10px] md:text-sm font-bold order-1 md:order-1">{entry.awayTeam.triCode}</span>
                                        </div>

                                        <span className="text-neutral-600 text-[10px] md:text-xs hidden md:inline">@</span>
                                        {/* Mobile 'vs' spacer or just stack? Stack implies @ visually usually. */}

                                        {/* Home */}
                                        <div className="flex items-center gap-1 md:gap-2 w-auto md:w-24 opacity-80">
                                            <div className="relative w-5 h-5 md:w-8 md:h-8">
                                                <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} fill className="object-contain" />
                                            </div>
                                            <span className="text-[10px] md:text-sm font-bold">{entry.homeTeam.triCode}</span>
                                        </div>
                                    </div>
                                </td>

                                {/* Score */}
                                <td className="p-2 md:p-4 text-center font-mono text-[10px] md:text-sm whitespace-nowrap">
                                    <div className="flex flex-col md:block">
                                        <span>{entry.awayScore}</span>
                                        <span className="md:hidden opacity-50">-</span>
                                        <span>{entry.homeScore}</span>
                                    </div>
                                </td>

                                {/* Prediction */}
                                <td className="p-2 md:p-4 text-center">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] md:text-sm font-bold text-blue-400 whitespace-nowrap">
                                            {entry.awayXg.toFixed(1)} - {entry.homeXg.toFixed(1)}
                                        </span>
                                        <span className="text-[8px] md:text-[10px] text-neutral-500 scale-75 md:scale-100 origin-center">xG</span>
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
