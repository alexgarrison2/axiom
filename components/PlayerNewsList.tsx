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
            <p className="label mb-1.5">
                News <span className="text-fg-2">{items.length}</span>
            </p>
            <ul className="flex flex-col gap-1.5">
                {items.map((item, i) => {
                    const text = item.news.toLowerCase().startsWith(item.player.toLowerCase())
                        ? item.news.substring(item.player.length).replace(/^[^a-zA-Z]+/, '')
                        : item.news;
                    const kind = classify(item.category, item.news);
                    return (
                        <li key={i} className="border-l border-line-strong pl-2 text-caption">
                            <article>
                                <header className="flex items-baseline gap-2">
                                    <strong className="font-display text-body-sm font-semibold text-fg-1">{item.player}</strong>
                                    <span className="text-micro uppercase tracking-[0.1em] text-fg-3">{KIND_LABEL[kind]}</span>
                                    {item.timestamp || item.date ? (
                                        <time dateTime={item.timestamp || item.date} className="ml-auto shrink-0 text-micro text-fg-3">
                                            {etLabel(item.timestamp || item.date)}
                                        </time>
                                    ) : null}
                                </header>
                                <p className="text-fg-2">{text}</p>
                            </article>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
