import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { teamTriFromName } from './names';
import { parseAccuracyReport, type AccuracyReport } from './report';
import { parseLedger } from './ledger-data';
import type { GradedGame, LedgerData } from './types';

// Literal, statically scoped paths so the tracer includes only these files.
function readJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

export function loadReport(): AccuracyReport {
    return parseAccuracyReport(readJson(path.join(process.cwd(), 'public', 'data', 'model_report.json')));
}

export function loadLedger(): LedgerData {
    return parseLedger(readJson(path.join(process.cwd(), 'public', 'data', 'bet_ledger.json')));
}

const teamTri = teamTriFromName;

type Obj = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Every graded NHL game (types 02/03) from data/prediction_history.json,
 * compacted. Rows whose teams aren't NHL clubs (e.g. Olympic games) are
 * dropped.
 */
export function loadGradedGames(): GradedGame[] {
    const raw = readJson(path.join(process.cwd(), 'data', 'prediction_history.json'));
    if (!Array.isArray(raw)) return [];
    const out: GradedGame[] = [];
    for (const r of raw as Obj[]) {
        if (!r || typeof r !== 'object') continue;
        const type = String(r.gameType ?? String(r.gameId ?? '').slice(4, 6));
        if (type !== '02' && type !== '03') continue;
        const home = teamTri(r.homeTeam as string);
        const away = teamTri(r.awayTeam as string);
        const hp = num(r.homeWinProb);
        const hs = num(r.homeScore);
        const as = num(r.awayScore);
        if (!home || !away || hp == null || hs == null || as == null) continue;
        const dec = String(r.decision ?? 'REG').toUpperCase();
        out.push({
            id: num(r.gameId) ?? 0,
            date: String(r.date ?? '').slice(0, 10),
            season: String(r.season ?? ''),
            type,
            home,
            away,
            homeScore: hs,
            awayScore: as,
            decision: dec === 'OT' || dec === 'SO' ? dec : 'REG',
            homeProb: hp,
            marketProb: num(r.marketHomeProb),
            homeXg: num(r.homeXg),
            awayXg: num(r.awayXg),
            brier: num(r.brierScore) ?? NaN,
            logLoss: num(r.logLoss) ?? NaN,
            retro: r.retro === true,
            snapshotUtc: typeof r.snapshotUtc === 'string' ? r.snapshotUtc : null,
        });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/** "2025-26" labels present in the history. */
export function historySeasons(games: GradedGame[]): string[] {
    return [...new Set(games.map(g => g.season).filter(Boolean))].sort().reverse();
}
