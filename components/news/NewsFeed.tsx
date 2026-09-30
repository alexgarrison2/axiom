'use client';

import * as React from 'react';
import Link from 'next/link';
import { FilterChip } from '@/components/ui/filter-chip';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import { LocalTime } from '@/components/ui/local-time';
import { KIND_LABEL, matchesFilter, type NewsCard, type NewsFilter, type NewsGroup, type NewsKind } from './model';

/** A group whose timestamps were formatted on the server (no hydration drift). */
export interface FeedGroup extends Omit<NewsGroup, 'cards'> {
    startLabel: string | null;
    cards: (NewsCard & { updates: (NewsCard['updates'][number] & { label: string })[] })[];
}

const FILTERS: { value: NewsFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'goalies', label: 'Goalies' },
    { value: 'injuries', label: 'Injuries' },
    { value: 'lineups', label: 'Lineups' },
];

const KIND_STYLE: Record<NewsKind, string> = {
    goalie: 'bg-info/15 text-info',
    injury: 'bg-neg/15 text-neg',
    returning: 'bg-pos/15 text-pos',
    lineup: 'bg-warn/15 text-warn',
    transaction: 'bg-brand/15 text-brand',
    other: 'bg-fg-3/15 text-fg-2',
};

const KIND_GLYPH: Record<NewsKind, string> = { goalie: '◎', injury: '✚', returning: '↩', lineup: '≡', transaction: '⇄', other: '•' };

export function NewsFeed({ groups, dayLabel }: { groups: FeedGroup[]; dayLabel: string | null }) {
    const [filter, setFilter] = React.useState<NewsFilter>('all');
    const counts = React.useMemo(() => {
        const all = groups.flatMap(g => g.cards);
        return Object.fromEntries(FILTERS.map(f => [f.value, all.filter(c => matchesFilter(c.kind, f.value)).length])) as Record<NewsFilter, number>;
    }, [groups]);
    const visible = groups
        .map(g => ({ ...g, cards: g.cards.filter(c => matchesFilter(c.kind, filter)) }))
        .filter(g => g.cards.length > 0 || (filter === 'all' && g.game));
    const games = groups.filter(g => g.game);

    return (
        <div className="flex flex-col gap-6">
            <div role="group" aria-label="Filter news" className="flex flex-wrap gap-2">
                {FILTERS.map(f => (
                    <FilterChip key={f.value} selected={filter === f.value} onSelectedChange={() => setFilter(f.value)} count={counts[f.value]}>
                        {f.label}
                    </FilterChip>
                ))}
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
                <div className="flex min-w-0 flex-col gap-8">
                    {visible.length === 0 ? <p className="hud-panel p-5 text-body-sm text-fg-2">No {filter === 'all' ? '' : `${filter} `}news right now.</p> : null}
                    {visible.map(g => (
                        <section key={g.key} id={g.key} aria-labelledby={`${g.key}-h`} className="flex scroll-mt-[calc(var(--appbar-h)+12px)] flex-col gap-3">
                            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2">
                                {g.game ? (
                                    <span aria-hidden="true" className="flex items-center -space-x-1">
                                        <TeamLogo tri={g.game.away} size={28} />
                                        <TeamLogo tri={g.game.home} size={28} />
                                    </span>
                                ) : null}
                                <h2 id={`${g.key}-h`} className="text-title font-black tracking-tight text-fg-1">
                                    {g.title}
                                    {g.game ? (
                                        <span className="sr-only">
                                            {' '}
                                            ({TEAM_NAMES[g.game.away]?.short} at {TEAM_NAMES[g.game.home]?.short})
                                        </span>
                                    ) : null}
                                </h2>
                                {g.game?.startUtc ? (
                                    <LocalTime iso={g.game.startUtc} className="text-body-sm text-fg-2" />
                                ) : g.startLabel ? (
                                    <span className="text-body-sm text-fg-2">{g.startLabel}</span>
                                ) : null}
                                {g.game ? (
                                    <Link
                                        href={`/#${g.game.away.toLowerCase()}-${g.game.home.toLowerCase()}`}
                                        className="ml-auto inline-flex min-h-9 items-center text-body-sm font-semibold text-brand hover:underline coarse:min-h-11"
                                    >
                                        Game preview →
                                    </Link>
                                ) : null}
                            </header>
                            {g.cards.length === 0 ? (
                                <p className="text-body-sm text-fg-3">No news for this game yet.</p>
                            ) : (
                                <div className="grid gap-3 md:grid-cols-2">
                                    {g.cards.map(c => (
                                        <NewsCardView key={c.id} card={c} />
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>

                {games.length ? (
                    <aside aria-label="Tonight's games" className="hidden lg:block">
                        <div className="hud-panel sticky top-[calc(var(--appbar-h)+16px)] flex flex-col gap-2 p-4">
                            <p className="hud-label">{dayLabel ?? 'Tonight'}</p>
                            <ul className="flex flex-col">
                                {games.map(g => (
                                    <li key={g.key}>
                                        <a href={`#${g.key}`} className="flex min-h-10 items-center gap-2 rounded-chip px-1 text-body-sm transition-colors hover:bg-surface-2">
                                            <TeamLogo tri={g.game!.away} size={18} />
                                            <span className="font-semibold text-fg-1">{g.title}</span>
                                            <span className="ml-auto rounded-full bg-surface-3 px-1.5 text-micro font-semibold text-fg-2">{g.cards.length}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </aside>
                ) : null}
            </div>
        </div>
    );
}

function NewsCardView({ card }: { card: FeedGroup['cards'][number] }) {
    const [latest, ...older] = card.updates;
    const name = TEAM_NAMES[card.team]?.short ?? card.team;
    return (
        <article className="hud-panel flex flex-col gap-2 p-4" aria-labelledby={`${card.id}-name`}>
            <header className="flex items-start gap-3">
                <TeamLogo tri={card.team} size={32} label={name} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                    <h3 id={`${card.id}-name`} className="text-body font-bold text-fg-1">
                        {card.player}
                    </h3>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-2">
                        <span className="font-mono">{card.team}</span>
                        <span className={cn('inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-micro font-semibold uppercase tracking-[0.04em]', KIND_STYLE[latest.kind])}>
                            <span aria-hidden="true">{KIND_GLYPH[latest.kind]}</span>
                            {KIND_LABEL[latest.kind]}
                        </span>
                        {older.length ? <span className="text-fg-3">{older.length + 1} updates</span> : null}
                    </p>
                </div>
            </header>
            <p className="text-body-sm text-fg-1">{latest.text}</p>
            {latest.at ? (
                <When at={latest.at} label={latest.label} className="text-caption text-fg-2" />
            ) : null}
            {older.length ? (
                <ol aria-label="Earlier updates" className="mt-1 flex flex-col gap-2 border-l border-line-strong pl-3">
                    {older.map((u, i) => (
                        <li key={i} className="relative text-caption text-fg-2">
                            <span aria-hidden="true" className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-fg-3" />
                            {u.at ? (
                                <When at={u.at} label={u.label} className="block text-fg-2" />
                            ) : null}
                            <span className="text-fg-2">{u.text}</span>
                        </li>
                    ))}
                </ol>
            ) : null}
        </article>
    );
}

export default NewsFeed;

/** A news timestamp: date-only values keep the server label; full instants go local via <LocalTime>. */
function When({ at, label, className }: { at: string; label: string; className?: string }) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(at) || Number.isNaN(new Date(at).getTime())) {
        return (
            <time dateTime={at} className={className}>
                {label}
            </time>
        );
    }
    return <LocalTime iso={at} style="datetime" className={className} />;
}
