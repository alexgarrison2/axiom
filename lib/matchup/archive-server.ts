import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { buildArchive, type ArchiveSlate, type HistoryRow, type NhlScoreGame } from './archive';
import { addDays } from './format';

/**
 * Server side of lib/matchup/archive: the NHL score feed for one day (Data
 * Cache: 5 min for recent days, a day for older ones) joined with the graded
 * record in data/prediction_history.json.
 */

// A literal path keeps the function trace small (see utils/data.ts).
function readHistory(): HistoryRow[] {
    try {
        const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'prediction_history.json'), 'utf8')) as unknown;
        return Array.isArray(d) ? (d as HistoryRow[]) : [];
    } catch {
        return [];
    }
}

async function scoreFeed(date: string, today: string): Promise<NhlScoreGame[] | null> {
    try {
        const old = date < addDays(today, -2);
        const res = await fetch(`https://api-web.nhle.com/v1/score/${date}`, {
            next: { revalidate: old ? 86_400 : 300 },
            signal: AbortSignal.timeout(4000),
            headers: { 'User-Agent': 'pony-xg (slate archive)' },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { games?: NhlScoreGame[] };
        return Array.isArray(body.games) ? body.games : [];
    } catch {
        return null;
    }
}

/** Every game on `date` with its final score and the graded pregame pick (if any). */
export async function getArchiveSlate(date: string, today: string): Promise<ArchiveSlate> {
    const [feed, history] = await Promise.all([scoreFeed(date, today), Promise.resolve(readHistory())]);
    return buildArchive(date, feed, history);
}
