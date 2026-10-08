/**
 * Shot-map files written by pipeline/goalie_shots.py:
 *   /data/goalie_shots/<seasonId>/<goalieId>.json  shots a goalie faced
 *   /data/goalie_shots/<seasonId>/league.json      save % baselines per danger bin and shot type
 *   /data/skater_shots/<seasonId>/<playerId>.json  shots a skater took
 * Each shot row: [gameIdx, x, y, xG, goal, onGoal, type, rebound, strength], with x, y
 * turned toward the net at x = +89. Strength is the goalie's side for goalie files
 * (0 even, 1 shorthanded, 2 power play) and the shooter's for skater files
 * (0 even, 1 power play, 2 shorthanded, 3 empty net).
 */

export type ShotRow = [number, number, number, number, 0 | 1, 0 | 1, number, 0 | 1, number];

export interface ShotFile {
    id: number;
    games: number[];
    shots: ShotRow[];
}

export interface ShotLeague {
    bins: { lo: number; hi: number; sog: number; goals: number; svPct: number | null }[];
    types: Record<string, { sog: number; svPct: number }>;
    typeNames: string[];
    svPct: number | null;
}

export const S = { game: 0, x: 1, y: 2, xg: 3, goal: 4, onGoal: 5, type: 6, rebound: 7, strength: 8 } as const;

export const goalieShotsUrl = (season: string, id: number) => `/data/goalie_shots/${season}/${id}.json`;
export const skaterShotsUrl = (season: string, id: number) => `/data/skater_shots/${season}/${id}.json`;
export const shotLeagueUrl = (season: string) => `/data/goalie_shots/${season}/league.json`;

const cache = new Map<string, Promise<unknown>>();

/** Fetch once per page session; a missing file (no shots yet) resolves to null. */
export function fetchShots<T>(url: string): Promise<T | null> {
    let p = cache.get(url) as Promise<T | null> | undefined;
    if (!p) {
        p = fetch(url)
            .then(r => (r.ok ? (r.json() as Promise<T>) : null))
            .catch(() => null);
        cache.set(url, p);
    }
    return p;
}

/** Wilson interval (80%) for a rate of `p` on `n` trials: the likely range for a small sample. */
export function wilson(p: number, n: number, z = 1.2816): [number, number] {
    if (!n) return [0, 1];
    const d = 1 + (z * z) / n;
    const c = p + (z * z) / (2 * n);
    const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return [(c - h) / d, (c + h) / d];
}
