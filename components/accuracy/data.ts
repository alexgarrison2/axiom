import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { teamTriFromName } from './names';
import { deriveExcluded, parseAccuracyReport, type AccuracyReport } from './report';
import { parseLedger } from './ledger-data';
import type { BetFinal, ExcludedGame, GradedGame, LedgerData } from './types';
export { tallyByType, tallySeason } from './report';

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

/** −110/−110 on both sides is the feed's placeholder, not a real market. */
export function isPlaceholderOdds(home: unknown, away: unknown): boolean {
    return num(home) === -110 && num(away) === -110;
}

/**
 * Every graded NHL game (types 02/03) from data/prediction_history.json,
 * compacted. Rows whose teams aren't NHL clubs (e.g. Olympic games) are
 * dropped.
 */
export function loadGradedGames(): GradedGame[] {
    return parseGradedGames(readJson(path.join(process.cwd(), 'data', 'prediction_history.json')));
}

/** The graded list from parsed prediction_history.json rows (pure; see loadGradedGames). */
export function parseGradedGames(raw: unknown): GradedGame[] {
    if (!Array.isArray(raw)) return [];
    const out: GradedGame[] = [];
    for (const r of raw as Obj[]) {
        if (!r || typeof r !== 'object' || r.excluded) continue;
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
            marketProb: isPlaceholderOdds(r.homeOdds, r.awayOdds) ? null : num(r.marketHomeProb),
            homeXg: num(r.homeXg),
            awayXg: num(r.awayXg),
            brier: num(r.brierScore) ?? NaN,
            logLoss: num(r.logLoss) ?? NaN,
            retro: r.retro === true,
            snapshotUtc: typeof r.snapshotUtc === 'string' ? r.snapshotUtc : null,
            legacy: r.modelVersion == null || r.modelVersion === '',
            placeholderOdds: isPlaceholderOdds(r.homeOdds, r.awayOdds),
        });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/** "2025-26" labels present in the history. */
export function historySeasons(games: GradedGame[]): string[] {
    return [...new Set(games.map(g => g.season).filter(Boolean))].sort().reverse();
}

/**
 * Final games left out of grading: explicit exclusion records in
 * prediction_history ({gameId, excluded}) and, as a fallback, any final in
 * gamestats.csv for the season that has no graded row.
 */
export function loadExcludedGames(season: string, graded: GradedGame[]): ExcludedGame[] {
    let csv = '';
    try {
        csv = fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'gamestats.csv'), 'utf8');
    } catch {
        csv = '';
    }
    return deriveExcluded(readJson(path.join(process.cwd(), 'data', 'prediction_history.json')), csv, season, graded, teamTri);
}

/** Finals for ledger bets the ledger file still lists as pending. */
export function pendingBetFinals(ledgerRaw: unknown, games: GradedGame[]): Record<number, BetFinal> {
    const byId = new Map(games.map(g => [g.id, g]));
    const out: Record<number, BetFinal> = {};
    const seasons = (ledgerRaw as Obj | null)?.seasons;
    if (!seasons || typeof seasons !== 'object') return out;
    for (const s of Object.values(seasons as Obj)) {
        const bets = (s as Obj | null)?.bets;
        if (!Array.isArray(bets)) continue;
        for (const b of bets as Obj[]) {
            if (b?.result !== 'pending' && b?.result != null) continue;
            const g = byId.get(num(b.gameId) ?? -1);
            if (g) out[g.id] = { homeScore: g.homeScore, awayScore: g.awayScore, decision: g.decision };
        }
    }
    return out;
}

export function loadLedgerRaw(): unknown {
    return readJson(path.join(process.cwd(), 'public', 'data', 'bet_ledger.json'));
}
