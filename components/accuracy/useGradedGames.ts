'use client';

import * as React from 'react';
import { useDataEpoch } from '@/lib/fresh';
import type { GradedGame } from './types';

const cache = new Map<string, Promise<GradedGame[]>>();
/** A season's graded rows, fetched once per data epoch (a stale tab coming back fetches again). */
function loadSeason(label: string, epoch: number): Promise<GradedGame[]> {
    const k = `${label}@${epoch}`;
    let p = cache.get(k);
    if (!p) {
        for (const old of cache.keys()) if (!old.endsWith(`@${epoch}`)) cache.delete(old);
        // A failed fetch rejects, so the cache entry is evicted and a retry refetches.
        p = fetch(`/accuracy/games/${label}`, epoch ? { cache: 'no-cache' } : undefined).then(r => {
            if (!r.ok) throw new Error(`picks ${label}: HTTP ${r.status}`);
            return r.json() as Promise<GradedGame[]>;
        });
        p.catch(() => cache.delete(k));
        cache.set(k, p);
    }
    return p;
}

export interface GradedGamesState {
    /** Newest first. While another season loads these are still the last selection's rows. */
    rows: GradedGame[];
    /** Nothing loaded yet for this selection. */
    loading: boolean;
    failed: boolean;
    retry: () => void;
}

/** The graded games of one season, or of every season for 'all': the one copy the whole /accuracy page reads. */
export function useGradedGames(season: string, seasons: string[]): GradedGamesState {
    const [games, setGames] = React.useState<{ key: string; rows: GradedGame[]; failed?: boolean } | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    const epoch = useDataEpoch();
    const key = `${season}#${attempt}#${epoch}`;
    React.useEffect(() => {
        let alive = true;
        const labels = season === 'all' ? seasons : [season];
        Promise.all(labels.map(l => loadSeason(l, epoch)))
            .then(lists => {
                if (alive) setGames({ key, rows: lists.flat().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id) });
            })
            .catch(() => alive && setGames({ key, rows: [], failed: true }));
        return () => {
            alive = false;
        };
    }, [key, season, seasons, epoch]);
    const retry = React.useCallback(() => setAttempt(a => a + 1), []);
    const rows = games?.rows;
    return React.useMemo(() => {
        const loading = !games || games.key !== key;
        return { rows: rows ?? [], loading, failed: !loading && !!games?.failed, retry };
    }, [games, rows, key, retry]);
}
