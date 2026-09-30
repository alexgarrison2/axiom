/**
 * Module-level JSON cache for the Teams table and team pages. A URL is
 * fetched at most once per page session (tab switches and client-side
 * route re-entry reuse the promise), and server-rendered payloads can be
 * primed so the first client interaction does not refetch them.
 */
const cache = new Map<string, Promise<unknown>>();

export function fetchJsonCached<T>(url: string): Promise<T> {
    let p = cache.get(url) as Promise<T> | undefined;
    if (!p) {
        p = fetch(url).then(res => {
            if (!res.ok) throw new Error(`${res.status} ${url}`);
            return res.json() as Promise<T>;
        });
        p.catch(() => cache.delete(url));
        cache.set(url, p);
    }
    return p;
}

export function primeCache<T>(url: string, value: T): void {
    if (!cache.has(url)) cache.set(url, Promise.resolve(value));
}

export function peekCached(url: string): boolean {
    return cache.has(url);
}

export const leagueUrl = (season: string) => `/api/teams/league/${season}`;
export const leagueGamesUrl = (season: string, periods = false) => `/api/teams/league/${season}/${periods ? 'games-full' : 'games'}`;
export const teamUrl = (tri: string, season: string) => `/api/teams/${tri}/stats/${season}`;
