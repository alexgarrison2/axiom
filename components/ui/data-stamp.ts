import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { parseDataTimestamp } from './freshness';

export interface DataStamp {
    /** ISO UTC of the last pipeline run that produced site data, or null. */
    generatedAt: string | null;
    /** Where the timestamp came from. */
    source: 'manifest' | 'last_updated' | 'none';
    seasonId?: string;
    mode?: string;
}

function readJson(rel: string): Record<string, unknown> | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * The site-wide "data as of" stamp. Prefers public/data/manifest.json
 * (generated_at, UTC ISO, written by refresh_pipeline) and falls back to the
 * legacy last_updated.json (Central-time string). If the manifest records a
 * newer `last_run_at` (a run that found nothing to change), that counts too.
 */
export function getDataStamp(): DataStamp {
    const manifest = readJson('public/data/manifest.json');
    if (manifest) {
        const candidates = [manifest.generated_at, manifest.last_run_at]
            .map(v => (typeof v === 'string' ? parseDataTimestamp(v) : null))
            .filter((d): d is Date => d !== null);
        if (candidates.length) {
            const latest = new Date(Math.max(...candidates.map(d => d.getTime())));
            return {
                generatedAt: latest.toISOString(),
                source: 'manifest',
                seasonId: typeof manifest.season_id === 'string' || typeof manifest.season_id === 'number' ? String(manifest.season_id) : undefined,
                mode: typeof manifest.mode === 'string' ? manifest.mode : undefined,
            };
        }
    }
    for (const rel of ['data/last_updated.json', 'public/data/last_updated.json']) {
        const legacy = readJson(rel);
        const d = typeof legacy?.last_refresh === 'string' ? parseDataTimestamp(legacy.last_refresh) : null;
        if (d) return { generatedAt: d.toISOString(), source: 'last_updated' };
    }
    return { generatedAt: null, source: 'none' };
}
