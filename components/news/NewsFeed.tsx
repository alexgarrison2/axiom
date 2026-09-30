'use client';

import * as React from 'react';
import Link from 'next/link';
import { FilterChip } from '@/components/ui/filter-chip';
import { PageHeading } from '@/components/ui/page-heading';
import { Crest } from '@/components/ui/crest';
import { clashSafePair, TEAM_NAMES } from '@/components/ui/team-color';
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

/** Kind tag: colour only where it means something (out = red, back = green, lineup = amber). */
const KIND_STYLE: Record<NewsKind, string> = {
    goalie: 'border-brand/45 text-brand',
    injury: 'border-neg/50 text-neg',
    returning: 'border-pos/45 text-pos',
    lineup: 'border-warn/50 text-warn',
    transaction: 'border-line-strong text-fg-2',
    other: 'border-line-strong text-fg-3',
};

const KIND_SHORT: Record<NewsKind, string> = { goalie: 'G', injury: 'INJ', returning: 'BACK', lineup: 'LINE', transaction: 'TXN', other: 'NEWS' };

export function NewsFeed({ groups, dayLabel }: { groups: FeedGroup[]; dayLabel: string | null }) {
    const [filter, setFilter] = React.useState<NewsFilter>('all');
    const counts = React.useMemo(() => {
        const all = groups.flatMap(g => g.cards);
        return Object.fromEntries(FILTERS.map(f => [f.value, all.filter(c => matchesFilter(c.kind, f.value)).length])) as Record<NewsFilter, number>;
    }, [groups]);
    const visible = groups
        .map(g => ({ ...g, cards: g.cards.filter(c => matchesFilter(c.kind, filter)) }))
        .filter(g => g.cards.length > 0 || (filter === 'all' && g.game));
    const games = visible.filter(g => g.game);
    const rest = visible.find(g => !g.game);

    const chips = (
        <div role="group" aria-label="Filter news" className="flex flex-wrap gap-1.5 max-sm:[&>button]:flex-1">
            {FILTERS.map(f => (
                <FilterChip key={f.value} selected={filter === f.value} onSelectedChange={() => setFilter(f.value)} count={counts[f.value]}>
                    {f.label}
                </FilterChip>
            ))}
        </div>
    );

    return (
        <div className="flex flex-col gap-4">
            <PageHeading title="News" tag={dayLabel ?? undefined} actions={<div className="hidden sm:block">{chips}</div>} />
            <div className="sm:hidden">{chips}</div>

            {visible.length === 0 ? <p className="panel label px-3 py-3">0 items</p> : null}

            {games.length ? (
                <div className="grid items-start gap-3 lg:grid-cols-2">
                    {games.map(g => (
                        <GameGroup key={g.key} group={g} />
                    ))}
                </div>
            ) : null}

            {rest ? (
                <section aria-labelledby={`${rest.key}-h`} className="panel overflow-hidden">
                    <header className="flex h-10 items-center border-b border-line px-3">
                        <h2 id={`${rest.key}-h`} className="heading-sub">
                            {rest.title}
                        </h2>
                        <span className="label ml-2">{rest.cards.length}</span>
                    </header>
                    <ul className="grid lg:grid-cols-2 lg:gap-x-px lg:bg-line">
                        {rest.cards.map(c => (
                            <NewsRow key={c.id} card={c} showTeam />
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}

function GameGroup({ group: g }: { group: FeedGroup }) {
    const game = g.game!;
    const wash = clashSafePair(game.away, game.home);
    return (
        <section
            id={g.key}
            aria-labelledby={`${g.key}-h`}
            className="panel team-wash scroll-mt-[calc(var(--appbar-h)+12px)] overflow-hidden"
            style={{ '--ac': wash.away, '--hc': wash.home } as React.CSSProperties}
        >
            <header className={cn('flex min-h-11 items-center gap-2.5 px-3 py-1.5', g.cards.length > 0 && 'border-b border-line')}>
                <span aria-hidden="true" className="flex items-center gap-1">
                    <Crest tri={game.away} size={24} className="drop-shadow-none" />
                    <Crest tri={game.home} size={24} className="drop-shadow-none" />
                </span>
                <h2 id={`${g.key}-h`} className="font-display text-title font-semibold uppercase tracking-[0.04em] text-fg-1">
                    {g.title}
                    <span className="sr-only">
                        {' '}
                        ({TEAM_NAMES[game.away]?.short} at {TEAM_NAMES[game.home]?.short})
                    </span>
                </h2>
                {game.startUtc ? (
                    <LocalTime iso={game.startUtc} className="label" />
                ) : g.startLabel ? (
                    <span className="label">{g.startLabel}</span>
                ) : null}
                <span className={cn('label', g.cards.length ? 'text-fg-2' : 'text-fg-3')}>
                    <span className="sr-only">News items: </span>
                    {g.cards.length}
                </span>
                <Link
                    href={`/#${game.away.toLowerCase()}-${game.home.toLowerCase()}`}
                    className="label ml-auto inline-flex min-h-8 items-center text-brand hover:underline coarse:min-h-11"
                >
                    Game<span className="sr-only"> preview</span> →
                </Link>
            </header>
            {g.cards.length ? (
                <ul>
                    {g.cards.map(c => (
                        <NewsRow key={c.id} card={c} />
                    ))}
                </ul>
            ) : null}
        </section>
    );
}

function NewsRow({ card, showTeam }: { card: FeedGroup['cards'][number]; showTeam?: boolean }) {
    const [latest, ...older] = card.updates;
    const name = TEAM_NAMES[card.team]?.short ?? card.team;
    return (
        <li className={cn("flex flex-col gap-0.5 border-t border-line/60 px-3 py-2 first:border-t-0", showTeam && "bg-surface-1 lg:[&:nth-child(2)]:border-t-0")}>
            <article aria-labelledby={`${card.id}-name`}>
                <header className="flex min-w-0 items-center gap-2">
                    <span className={cn('shrink-0 rounded-chip border px-1 text-micro font-medium uppercase tracking-[0.1em]', KIND_STYLE[latest.kind])}>
                        <abbr title={KIND_LABEL[latest.kind]} className="no-underline">
                            {KIND_SHORT[latest.kind]}
                        </abbr>
                    </span>
                    <Crest tri={card.team} size={16} alt={name} className="drop-shadow-none" />
                    <h3 id={`${card.id}-name`} className="min-w-0 truncate font-display text-body font-semibold text-fg-1">
                        {card.player}
                    </h3>
                    {showTeam ? <span className="text-micro text-fg-3">{card.team}</span> : null}
                    {latest.at ? <When at={latest.at} label={latest.label} className="ml-auto hidden shrink-0 text-micro text-fg-3 sm:block" /> : null}
                </header>
                <p className="mt-0.5 text-caption text-fg-2">{latest.text}</p>
                {latest.at ? <When at={latest.at} label={latest.label} className="block text-micro text-fg-3 sm:hidden" /> : null}
                {older.length ? (
                    <details className="group mt-0.5">
                        <summary className="label inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-fg-3 hover:text-fg-1 [&::-webkit-details-marker]:hidden">
                            <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                                ▸
                            </span>
                            +{older.length}
                            <span className="sr-only"> earlier {older.length === 1 ? 'update' : 'updates'}</span>
                        </summary>
                        <ol className="mt-1 flex flex-col gap-1 border-l border-line-strong pl-2.5">
                            {older.map((u, i) => (
                                <li key={i} className="text-caption text-fg-2">
                                    {u.at ? <When at={u.at} label={u.label} className="mr-2 text-micro text-fg-3" /> : null}
                                    {u.text}
                                </li>
                            ))}
                        </ol>
                    </details>
                ) : null}
            </article>
        </li>
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
