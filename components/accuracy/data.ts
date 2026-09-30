import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { teamTriFromName } from './names';
import { parseAccuracyReport, type AccuracyReport } from './report';
import { parseLedger } from './ledger-data';
import type { BetFinal, ExcludedGame, GradedGame, LedgerData } from './types';
export { tallySeason } from './report';

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

const seasonOfId = (id: number): string => {
    const y = Math.floor(id / 1_000_000);
    return y > 1900 ? `${y}-${String(y + 1).slice(2)}` : '';
};

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

const REASONS: Record<string, string> = {
    snapshot_after_start: 'No pregame snapshot before puck drop',
    no_snapshot: 'No pregame snapshot before puck drop',
};

/**
 * Final games left out of grading. Reads explicit exclusion records from
 * prediction_history ({gameId, excluded}) and, as a fallback, any final in
 * gamestats.csv for the season that has no graded row.
 */
export function loadExcludedGames(season: string, graded: GradedGame[]): ExcludedGame[] {
    const out = new Map<number, ExcludedGame>();
    const gradedIds = new Set(graded.map(g => g.id));
    const raw = readJson(path.join(process.cwd(), 'data', 'prediction_history.json'));
    if (Array.isArray(raw)) {
        for (const r of raw as Obj[]) {
            if (!r || typeof r !== 'object' || !r.excluded) continue;
            const id = num(r.gameId) ?? 0;
            if (!id || gradedIds.has(id)) continue;
            if ((String(r.season ?? '') || seasonOfId(id)) !== season) continue;
            out.set(id, {
                id,
                date: String(r.date ?? '').slice(0, 10),
                home: teamTri(r.homeTeam as string) ?? String(r.homeTeam ?? ''),
                away: teamTri(r.awayTeam as string) ?? String(r.awayTeam ?? ''),
                reason: REASONS[String(r.excluded)] ?? String(r.excluded).replace(/_/g, ' '),
            });
        }
    }
    let csv = '';
    try {
        csv = fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'gamestats.csv'), 'utf8');
    } catch {
        csv = '';
    }
    const lines = csv.split('\n');
    const head = (lines[0] ?? '').split(',');
    const [iId, iDate, iTeam, iOpp, iHA] = ['game_id', 'game_date', 'team', 'opponent', 'home_away'].map(k => head.indexOf(k));
    if (iId >= 0 && iTeam >= 0 && iOpp >= 0 && iHA >= 0) {
        for (const line of lines.slice(1)) {
            const c = line.split(',');
            const id = Number(c[iId]);
            if (!id || c[iHA] !== 'Home' || gradedIds.has(id) || out.has(id) || seasonOfId(id) !== season) continue;
            const type = String(id).slice(4, 6);
            if (type !== '02' && type !== '03') continue;
            const home = teamTri(c[iTeam]);
            const away = teamTri(c[iOpp]);
            if (!home || !away) continue;
            out.set(id, { id, date: (c[iDate] ?? '').slice(0, 10), home, away, reason: 'No pregame snapshot before puck drop' });
        }
    }
    return [...out.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
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
