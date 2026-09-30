'use client';

import type { PlayerNewsItem } from '@/utils/data';
import { classify, KIND_LABEL } from './news/model';
import { etLabel } from './news/feed';

interface PlayerNewsListProps {
    news: PlayerNewsItem[];
    teamTriCode: string;
}

/** Compact player-news list for a matchup card (goalie-start items are shown elsewhere). */
export default function PlayerNewsList({ news, teamTriCode }: PlayerNewsListProps) {
    if (!news || news.length === 0) return null;
    const items = news.filter(n => {
        const cat = n.category?.toLowerCase() || '';
        return !(cat.includes('goalie') && cat.includes('start'));
    });
    if (items.length === 0) return null;

    return (
        <section aria-label={`${teamTriCode} player news`} className="flex w-full flex-col text-left">
            <div className="mb-2 flex items-center gap-2">
                <span className="hud-label">Player news</span>
                <span className="rounded-full bg-surface-3 px-1.5 text-micro font-semibold text-fg-2">{items.length}</span>
            </div>
            <ul className="flex flex-col gap-2">
                {items.map((item, i) => {
                    const text = item.news.toLowerCase().startsWith(item.player.toLowerCase())
                        ? item.news.substring(item.player.length).replace(/^[^a-zA-Z]+/, '')
                        : item.news;
                    const kind = classify(item.category, item.news);
                    return (
                        <li key={i} className="border-l-2 border-warn/60 py-0.5 pl-2 text-caption leading-snug">
                            <article>
                                <strong className="font-bold text-fg-1">{item.player}</strong>
                                <span className="ml-1 text-micro font-semibold uppercase text-fg-2">{KIND_LABEL[kind]}</span>
                                <p className="text-fg-2">{text}</p>
                                {item.timestamp || item.date ? (
                                    <time dateTime={item.timestamp || item.date} className="text-micro text-fg-2">
                                        {etLabel(item.timestamp || item.date)}
                                    </time>
                                ) : null}
                            </article>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
