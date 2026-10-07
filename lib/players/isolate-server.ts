import fs from 'node:fs';
import path from 'node:path';
import { isolateFor, type IsolateDoc, type IsolateView } from './isolate';

/* Server-only (node:fs); never import from a client component.
 * public/data/isolate/<season>.json, re-read when the file changes. */
const cache = new Map<string, { mtime: number; doc: IsolateDoc | null }>();

function readDoc(season: string): IsolateDoc | null {
    if (!/^\d{8}$/.test(season)) return null;
    const file = path.join(process.cwd(), 'public', 'data', 'isolate', `${season}.json`);
    let mtime = -1;
    try {
        mtime = fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
    const hit = cache.get(season);
    if (hit && hit.mtime === mtime) return hit.doc;
    let doc: IsolateDoc | null = null;
    try {
        doc = JSON.parse(fs.readFileSync(file, 'utf8')) as IsolateDoc;
    } catch {
        doc = null;
    }
    cache.set(season, { mtime, doc });
    return doc;
}

/** One skater's isolated impact for a season (its multi-season window), or null. */
export function loadIsolate(season: string, id: number): IsolateView | null {
    return isolateFor(readDoc(season), id);
}
