'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Prediction } from '@/types/prediction';
import { findImplication, type GameImplicationsData } from '@/utils/implications';
import { cardAnchor, phaseOf, type LiveMap } from '@/lib/matchup/lifecycle';
import { weekdayDate } from '@/lib/matchup/format';
import { MatchupCard } from './MatchupCard';
import { GameRailItem } from './GameRailItem';
import type { Tab } from './Details';
import styles from './slate.module.css';

/** The game to open first: the one the URL names, else the first live game, else the first on the slate. */
function defaultId(slate: Prediction[], live: LiveMap, anchor: string | null): string | null {
    const named = anchor ? slate.find(p => cardAnchor(p) === anchor) : null;
    if (named) return named.id;
    return (slate.find(p => phaseOf(p, live[p.id]) === 'live') ?? slate[0])?.id ?? null;
}

/**
 * Desktop slate: a rail of every game on the left, the selected game open in
 * the pane beside it. The rail sticks while the page scrolls the pane, so
 * there is no inner scroller; switching games slides the pane in from the
 * direction of the move and the rail's indicator glides to the new row.
 */
export function SlatePane({
    slate,
    live,
    implications,
    playoffOdds,
    series,
    focusAnchor,
    heading,
}: {
    slate: Prediction[];
    live: LiveMap;
    implications: GameImplicationsData | null;
    playoffOdds: Record<string, number>;
    series?: Record<string, { away: number; home: number }>;
    /** Anchor of a game a link asked for ("van-edm"). */
    focusAnchor: string | null;
    heading: string;
}) {
    const [picked, setPicked] = useState<{ id: string; dir: 'up' | 'down' | null } | null>(null);
    const [tab, setTab] = useState<Tab>('form');
    const listRef = useRef<HTMLUListElement>(null);
    const paneRef = useRef<HTMLDivElement>(null);
    const [bar, setBar] = useState<{ top: number; height: number } | null>(null);

    // A link to one game (the hash, a "biggest games" jump) opens it: adjust state while rendering, not in an effect.
    const [seenFocus, setSeenFocus] = useState<string | null>(null);
    if (focusAnchor !== seenFocus) {
        setSeenFocus(focusAnchor);
        const named = focusAnchor ? slate.find(x => cardAnchor(x) === focusAnchor) : null;
        if (named) setPicked({ id: named.id, dir: null });
    }

    const ids = useMemo(() => slate.map(p => p.id), [slate]);
    const selectedId = picked && ids.includes(picked.id) ? picked.id : defaultId(slate, live, null);
    const index = selectedId ? ids.indexOf(selectedId) : -1;
    const selected = index >= 0 ? slate[index] : null;

    const select = useCallback(
        (id: string, scrollPane = true) => {
            setPicked(cur => {
                const from = ids.indexOf(cur?.id ?? defaultId(slate, live, null) ?? '');
                const to = ids.indexOf(id);
                return { id, dir: from === to || from < 0 ? null : to > from ? 'down' : 'up' };
            });
            const p = slate.find(x => x.id === id);
            if (p) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${cardAnchor(p)}`);
            if (scrollPane) {
                const top = paneRef.current?.getBoundingClientRect().top ?? 0;
                if (top < 0) paneRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
            }
        },
        [ids, slate, live],
    );

    // The indicator glides to the selected row.
    useLayoutEffect(() => {
        const measure = () => {
            const li = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.parentElement;
            setBar(li ? { top: li.offsetTop, height: li.offsetHeight } : null);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [selectedId, slate, live]);

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const next = ids[Math.min(ids.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (!next || next === selectedId) return;
        select(next);
        requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: false }));
    };

    if (!selected) return null;
    return (
        <div className="grid grid-cols-[22.5rem_minmax(0,1fr)] items-start gap-4">
            <nav aria-label={`Games, ${heading}`} className="sticky top-[var(--appbar-h)] -m-3 max-h-[calc(100dvh-var(--appbar-h))] overflow-y-auto p-3 overscroll-contain scrollbar-hide">
                <ul ref={listRef} onKeyDown={onKey} className="panel relative flex flex-col divide-y divide-line p-1.5">
                    {bar ? (
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-1.5 z-10 rounded-card border border-brand/60 bg-brand/5 shadow-[inset_0_0_14px_rgba(41,231,255,.12),0_0_16px_rgba(41,231,255,.14)] transition-[top,height] duration-300 ease-out motion-reduce:transition-none"
                            style={{ top: bar.top, height: bar.height }}
                        />
                    ) : null}
                    {slate.map(p => (
                        <li key={p.id} className="relative">
                            <GameRailItem p={p} live={live[p.id] ?? null} selected={p.id === selectedId} onSelect={() => select(p.id)} />
                        </li>
                    ))}
                </ul>
            </nav>
            <div ref={paneRef} className="min-w-0 scroll-mt-[calc(var(--appbar-h)+12px)]" aria-label={`${weekdayDate(selected.date)} game`} role="region">
                <div key={selected.id} className={styles.paneIn} data-dir={picked?.dir ?? undefined}>
                    <MatchupCard
                        p={selected}
                        live={live[selected.id] ?? null}
                        implication={findImplication(implications, selected.home.team.triCode, selected.away.team.triCode)}
                        playoffOdds={playoffOdds}
                        seriesScore={series?.[`${selected.away.team.triCode}|${selected.home.team.triCode}`] ?? null}
                        pinned
                        noAnchor
                        detailTab={tab}
                        onDetailTab={setTab}
                    />
                </div>
            </div>
        </div>
    );
}

export default SlatePane;
