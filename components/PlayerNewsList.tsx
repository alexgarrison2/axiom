'use client';

import { PlayerNewsItem } from '@/utils/data';

interface PlayerNewsListProps {
    news: PlayerNewsItem[];
    teamTriCode: string;
}

export default function PlayerNewsList({ news, teamTriCode }: PlayerNewsListProps) {
    if (!news || news.length === 0) return null;

    // Filter out goalie announcements for game cards
    const filteredNews = news.filter(n => {
        const cat = n.category?.toLowerCase() || '';
        return !(cat.includes('goalie') && cat.includes('start'));
    });

    if (filteredNews.length === 0) return null;

    return (
        <div className="flex flex-col w-full text-left">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Player News</span>
                <span className="text-[9px] text-neutral-600 bg-neutral-900 px-1.5 rounded">{filteredNews.length}</span>
            </div>

            <div className="flex flex-col gap-2">
                {filteredNews.map((item, index) => (
                    <div key={index} className="flex gap-2 items-start text-xs border-l-2 border-orange-500/50 pl-2 py-0.5">
                        <span className="text-neutral-300 leading-tight">
                            <span className="font-bold text-white mr-1">{item.player}:</span>
                            {/* If news starts with player name, trim it to avoid repetition? 
                                User example: "Dumba: healthy scratch vs. ANA"
                                Scraper output: "Dumba (injury)..." -> "Dumba: Dumba (injury)..." -> Weird.
                                
                                Let's check if news starts with player name.
                            */}
                            {item.news.toLowerCase().startsWith(item.player.toLowerCase())
                                ? item.news.substring(item.player.length).replace(/^[^a-zA-Z]+/, '') // Remove leading punctuation
                                : item.news
                            }
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
