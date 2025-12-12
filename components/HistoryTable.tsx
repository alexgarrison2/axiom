import React from 'react';
import Image from 'next/image';
import { HistoryEntry } from '../utils/data';

interface HistoryTableProps {
    entries: HistoryEntry[];
}

const HistoryTable: React.FC<HistoryTableProps> = ({ entries }) => {
    return (
        <div className="w-full max-w-6xl mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-white/5 border-b border-white/10 text-neutral-400 text-xs uppercase tracking-widest">
                            <th className="p-4 font-normal">Date</th>
                            <th className="p-4 font-normal">Matchup</th>
                            <th className="p-4 font-normal text-center">Score</th>
                            <th className="p-4 font-normal text-center">Prediction</th>
                            <th className="p-4 font-normal text-center">Result</th>
                            <th className="p-4 font-normal text-right">Brier Score</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {entries.map((entry, idx) => (
                            <tr
                                key={`${entry.date}-${entry.homeTeam.triCode}-${entry.awayTeam.triCode}`}
                                className="hover:bg-white/[0.02] transition-colors"
                            >
                                {/* Date */}
                                <td className="p-4 text-sm font-mono text-neutral-400">
                                    {new Date(entry.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}
                                </td>

                                {/* Matchup */}
                                <td className="p-4">
                                    <div className="flex items-center gap-4">
                                        {/* Away */}
                                        <div className="flex items-center gap-2 w-24 justify-end opacity-80">
                                            <span className="text-sm font-bold">{entry.awayTeam.triCode}</span>
                                            <div className="relative w-8 h-8">
                                                <Image src={entry.awayTeam.logoUrl} alt={entry.awayTeam.name} fill className="object-contain" />
                                            </div>
                                        </div>

                                        <span className="text-neutral-600 text-xs">@</span>

                                        {/* Home */}
                                        <div className="flex items-center gap-2 w-24 opacity-80">
                                            <div className="relative w-8 h-8">
                                                <Image src={entry.homeTeam.logoUrl} alt={entry.homeTeam.name} fill className="object-contain" />
                                            </div>
                                            <span className="text-sm font-bold">{entry.homeTeam.triCode}</span>
                                        </div>
                                    </div>
                                </td>

                                {/* Score */}
                                <td className="p-4 text-center font-mono text-sm">
                                    {entry.awayScore} - {entry.homeScore}
                                </td>

                                {/* Prediction */}
                                <td className="p-4 text-center">
                                    <div className="flex flex-col items-center">
                                        <span className="text-sm font-bold text-blue-400">
                                            {entry.awayXg.toFixed(2)} - {entry.homeXg.toFixed(2)}
                                        </span>
                                        <span className="text-[10px] text-neutral-500">xG Model</span>
                                    </div>
                                </td>

                                {/* Result */}
                                <td className="p-4 text-center">
                                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${entry.isCorrect
                                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                        : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                        {entry.isCorrect ? (
                                            <>
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                                CORRECT
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                                WRONG
                                            </>
                                        )}
                                    </div>
                                </td>

                                {/* Brier Score */}
                                <td className="p-4 text-right font-mono text-xs text-neutral-500">
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
