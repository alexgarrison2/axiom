'use client';

import { useEffect, useRef, useState } from 'react';
import type { Prediction } from '@/types/prediction';
import { pollInterval, slateDone, type LiveGame, type LiveMap } from '@/lib/matchup/lifecycle';

/**
 * Live scores for the games on one slate day, from /api/scores.
 *
 * Polls every 30s while a game is live (or about to start) and every 5 min
 * otherwise once the slate has started; stops once every game is final with
 * a score; never requests a slate that hasn't started (it only re-checks the
 * clock once a minute); pauses while the tab is hidden and catches up when
 * it becomes visible again.
 */
export function useLiveScores(date: string | null, games: Prediction[]): LiveMap {
    const [live, setLive] = useState<LiveMap>({});
    const liveRef = useRef<LiveMap>({});
    const gamesRef = useRef(games);

    useEffect(() => {
        gamesRef.current = games;
    }, [games]);

    useEffect(() => {
        if (!date) return;
        let timer: number | undefined;
        let stopped = false;
        let inflight: AbortController | null = null;
        const hidden = () => document.visibilityState === 'hidden';

        const schedule = () => {
            window.clearTimeout(timer);
            if (stopped || hidden() || slateDone(gamesRef.current, liveRef.current)) return;
            const ms = pollInterval(gamesRef.current, liveRef.current, Date.now());
            timer = window.setTimeout(ms == null ? schedule : tick, ms ?? 60_000);
        };

        const tick = async () => {
            if (stopped || hidden()) return;
            inflight?.abort();
            inflight = new AbortController();
            try {
                const res = await fetch(`/api/scores?date=${encodeURIComponent(date)}`, { signal: inflight.signal });
                if (res.ok) {
                    const body = (await res.json()) as { games?: LiveGame[] };
                    const ids = new Set(gamesRef.current.map(g => g.id));
                    const next: LiveMap = { ...liveRef.current };
                    for (const g of body.games ?? []) if (ids.has(g.id)) next[g.id] = g;
                    liveRef.current = next;
                    setLive(next);
                }
            } catch {
                /* network hiccup or abort: the next tick retries */
            }
            schedule();
        };

        const start = () => {
            if (stopped || hidden()) return;
            if (pollInterval(gamesRef.current, liveRef.current, Date.now()) != null) void tick();
            else schedule();
        };

        const onVisibility = () => {
            if (hidden()) window.clearTimeout(timer);
            else start();
        };

        // Let the games ref settle for this date before the first check.
        timer = window.setTimeout(start, 0);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            inflight?.abort();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [date]);

    return live;
}

export default useLiveScores;
