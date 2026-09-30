import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { archiveYear, type PlayoffArchive } from './types';

// Only this directory is read at request/build time; nothing else in
// public/data or pipeline/ (see next.config.ts tracing for /playoffs).
const ARCHIVE_DIR = path.join(process.cwd(), 'public', 'data', 'playoffs');

/** Season ids with a summary.json, newest first (e.g. ["20252026"]). */
export function listArchiveSeasons(): string[] {
    try {
        return fs
            .readdirSync(ARCHIVE_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && /^\d{4}$/.test(d.name) && fs.existsSync(path.join(ARCHIVE_DIR, d.name, 'summary.json')))
            .map(d => `${Number(d.name) - 1}${d.name}`)
            .sort((a, b) => b.localeCompare(a));
    } catch {
        return [];
    }
}

export function readArchive(seasonId: string): PlayoffArchive | null {
    const year = archiveYear(seasonId);
    if (!year) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, String(year), 'summary.json'), 'utf8')) as PlayoffArchive;
        return raw && Array.isArray(raw.series) ? raw : null;
    } catch {
        return null;
    }
}
