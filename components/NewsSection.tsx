'use client';

import React, { useMemo } from 'react';
import { GamePrediction, PlayerNewsItem, Team } from '@/utils/data';
import Image from 'next/image';
import { motion } from 'framer-motion';

interface NewsSectionProps {
    predictions: GamePrediction[];
}

interface NewsWithTeam extends PlayerNewsItem {
    team: Team;
}

const NewsSection: React.FC<NewsSectionProps> = ({ predictions }) => {
    const allNews = useMemo(() => {
        const news: NewsWithTeam[] = [];
        predictions.forEach(p => {
            if (p.home_news) {
                p.home_news.forEach(n => news.push({ ...n, team: p.homeTeam }));
            }
            if (p.away_news) {
                p.away_news.forEach(n => news.push({ ...n, team: p.awayTeam }));
            }
        });
        // Sort by date descending (assuming YYYY-MM-DD)
        return news.sort((a, b) => b.date.localeCompare(a.date));
    }, [predictions]);

    if (allNews.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
                <div className="p-6 rounded-full bg-white/5 border border-white/10 text-neutral-500">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                        <path d="M18 14h-8" />
                        <path d="M15 18h-5" />
                        <path d="M10 6h8v4h-8V6Z" />
                    </svg>
                </div>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-white mb-2 uppercase tracking-widest">No News Reported</h3>
                    <p className="text-neutral-500 font-mono text-sm uppercase">Check back closer to game time for updates.</p>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            className="flex flex-col gap-4 max-w-4xl mx-auto pb-24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
        >
            {allNews.map((item, idx) => (
                <motion.div
                    key={`${item.player}-${idx}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.05, 1) }}
                    className="glass-premium p-4 md:p-6 rounded-3xl flex items-start gap-6 hover:border-white/20 transition-all duration-300 group"
                >
                    {/* Team Logo Column */}
                    <div className="relative w-14 h-14 md:w-20 md:h-20 flex-shrink-0 bg-black/40 rounded-2xl p-2 border border-white/5 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] transition-all">
                        <Image
                            src={item.team.logoUrl}
                            alt={item.team.name}
                            fill
                            className="object-contain p-1"
                        />
                    </div>

                    {/* Content Column */}
                    <div className="flex flex-col gap-2 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-base md:text-lg font-black text-white tracking-tight">{item.player}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-neutral-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">{item.team.triCode}</span>
                                {item.category && (
                                    <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${item.category.toLowerCase().includes('injury')
                                            ? 'text-red-400 bg-red-400/10 border-red-400/20 shadow-[0_0_10px_rgba(248,113,113,0.1)]'
                                            : 'text-blue-400 bg-blue-400/10 border-blue-400/20'
                                        }`}>
                                        {item.category}
                                    </span>
                                )}
                            </div>
                            <span className="ml-auto text-[10px] md:text-xs font-mono text-neutral-600 font-bold tracking-widest uppercase">{item.date}</span>
                        </div>

                        <p className="text-sm md:text-base text-neutral-400 leading-relaxed md:leading-relaxed">
                            {item.news}
                        </p>
                    </div>
                </motion.div>
            ))}
        </motion.div>
    );
};

export default NewsSection;
