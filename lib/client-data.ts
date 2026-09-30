'use client';

/**
 * Memoized, module-level loaders for data the home slate fetches on demand.
 * Each URL is requested at most once per page load, however many cards ask
 * for it (and a failed request can be retried).
 */
import type { MatchupDetails, MatchupDetailsPayload, PickSummaries } from '../types/prediction';

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(url: string): Promise<T> {
    let p = cache.get(url) as Promise<T> | undefined;
    if (!p) {
        p = fetch(url).then(r => {
            if (!r.ok) throw new Error(`${url}: ${r.status}`);
            return r.json() as Promise<T>;
        });
        p.catch(() => cache.delete(url));
        cache.set(url, p);
    }
    return p;
}

/** Lineups, goalie tandems, injuries, recent games and news for every game on the slate. */
export function loadMatchupDetails(): Promise<MatchupDetailsPayload> {
    return loadJson<MatchupDetailsPayload>('/api/matchup-details');
}

export type GameDetails = MatchupDetails & { picks: PickSummaries };

/** One game's details plus the slate's pick record. */
export async function loadGameDetails(gameId: string): Promise<GameDetails | null> {
    const d = await loadMatchupDetails();
    const g = d.games[gameId];
    return g ? { ...g, picks: d.picks ?? {} } : null;
}

/** Test hook: forget every cached request. */
export function resetClientData() {
    cache.clear();
}
