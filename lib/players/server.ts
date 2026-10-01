import fs from 'node:fs';
import path from 'node:path';
import { parseRatings, type Ratings } from './ratings';

/* Server-only (node:fs); never import from a client component.
 *
 * Server readers for the player ratings. The ratings file is read by a
 * literal path (a variable path makes Turbopack trace all of public/data
 * into every function that imports this module).
 */
let ratingsCache: { mtime: number; r: Ratings } | null = null;

export function readRatingsDoc(): unknown {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'player_ratings.json'), 'utf8'));
    } catch {
        return null;
    }
}

/** Parsed public/data/player_ratings.json (empty when missing). */
export function loadRatings(): Ratings {
    let mtime = 0;
    try {
        mtime = fs.statSync(path.join(process.cwd(), 'public', 'data', 'player_ratings.json')).mtimeMs;
    } catch {
        mtime = -1;
    }
    if (ratingsCache && ratingsCache.mtime === mtime) return ratingsCache.r;
    const r = parseRatings(readRatingsDoc());
    ratingsCache = { mtime, r };
    return r;
}

export function readBio(): unknown {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'player_bio.json'), 'utf8'));
    } catch {
        return null;
    }
}
