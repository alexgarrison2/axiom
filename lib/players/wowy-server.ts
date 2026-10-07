import fs from 'node:fs';
import path from 'node:path';
import { wowyFor, type WowyDoc, type WowyPlayer } from './wowy';

/* Server-only (node:fs); never import from a client component.
 * public/data/wowy/<season>.json, re-read when the file changes. */
const cache = new Map<string, { mtime: number; doc: WowyDoc | null }>();

function readDoc(season: string): WowyDoc | null {
    if (!/^\d{8}$/.test(season)) return null;
    const file = path.join(process.cwd(), 'public', 'data', 'wowy', `${season}.json`);
    let mtime = -1;
    try {
        mtime = fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
    const hit = cache.get(season);
    if (hit && hit.mtime === mtime) return hit.doc;
    let doc: WowyDoc | null = null;
    try {
        doc = JSON.parse(fs.readFileSync(file, 'utf8')) as WowyDoc;
    } catch {
        doc = null;
    }
    cache.set(season, { mtime, doc });
    return doc;
}

/** One skater's with-or-without samples for a season, or null. */
export function loadWowy(season: string, id: number): WowyPlayer | null {
    return wowyFor(readDoc(season), id);
}
