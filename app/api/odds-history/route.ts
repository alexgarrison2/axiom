import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

/**
 * Moneyline (and, where snapshotted, game total) movement for one game from the frozen pregame snapshots in
 * public/data/SiteHistory/<date>.csv.
 *
 *   GET /api/odds-history?gameId=2026020008&date=2026-09-30
 *
 * gameId is the 10-digit NHL id (matched against an NHL-id column when the
 * snapshot has one); `legacyId` is the snapshot's "gameid" key
 * ("2026-09-30-Islanders-Maple Leafs"), which today's snapshots use. Inputs are validated
 * before any filesystem access; the resolved path must stay inside
 * SiteHistory.
 */
export interface OddsEntry {
    /** ISO UTC when available, else the legacy Central "HH:MM". */
    timestamp: string;
    awayOdds: string;
    homeOdds: string;
    awayDir: 'up' | 'down' | null;
    homeDir: 'up' | 'down' | null;
    isOpen: boolean;
    isLatest: boolean;
    /** Game total at this snapshot (older snapshots have none). */
    total?: OddsTotal | null;
    /** 'up' = the total line went up, 'down' = it came down, null = same line. */
    totalDir?: 'up' | 'down' | null;
}

export interface OddsTotal {
    /** Over/under goals line, e.g. "6" or "5.5". */
    line: string;
    /** American prices, e.g. "-117". */
    over: string;
    under: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d{10}$/;
const LEGACY_RE = /^\d{4}-\d{2}-\d{2}-[\p{L} .'’-]{2,40}-[\p{L} .'’-]{2,40}$/u;
const HISTORY_DIR = path.join(process.cwd(), 'public', 'data', 'SiteHistory');

const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

function oddsNum(odds: string): number {
    return parseInt((odds ?? '').replace(/[^-\d]/g, ''), 10) || 0;
}

function totalOf(row: Record<string, string>): OddsTotal | null {
    const line = (row.total_line ?? '').trim();
    const n = Number(line);
    if (!line || !Number.isFinite(n) || n < 3 || n > 12) return null;
    return { line: String(n), over: (row.total_over ?? '').trim(), under: (row.total_under ?? '').trim() };
}

const totalKey = (t: OddsTotal | null) => (t ? `${t.line}|${t.over}|${t.under}` : '');

function dir(curr: string, prev: string): 'up' | 'down' | null {
    const c = oddsNum(curr);
    const p = oddsNum(prev);
    return c > p ? 'up' : c < p ? 'down' : null;
}

export async function GET(request: NextRequest) {
    const sp = request.nextUrl.searchParams;
    const gameId = sp.get('gameId') ?? '';
    const date = sp.get('date') ?? '';
    const legacyId = sp.get('legacyId');

    if (!DATE_RE.test(date)) return bad('date must be YYYY-MM-DD');
    if (!ID_RE.test(gameId)) return bad('gameId must be a 10-digit NHL game id');
    if (legacyId != null && !LEGACY_RE.test(legacyId)) return bad('invalid legacyId');

    const csvPath = path.resolve(HISTORY_DIR, `${date}.csv`);
    if (path.dirname(csvPath) !== HISTORY_DIR) return bad('invalid date');

    const headers = { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' };
    let csv: string;
    try {
        csv = await fs.promises.readFile(csvPath, 'utf-8');
    } catch {
        return NextResponse.json({ entries: [] }, { headers });
    }

    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const idCols = ['nhl_game_id', 'nhlGameId', 'game_pk', 'gamePk'];
    const rows = parsed.data.filter(r => {
        if (!r.away_Odds || !r.home_Odds) return false;
        if (idCols.some(c => r[c] === gameId)) return true;
        return legacyId != null && r.gameid === legacyId;
    });
    if (rows.length === 0) return NextResponse.json({ entries: [] }, { headers });

    // Drop consecutive identical snapshots (same moneyline and same total),
    // then keep the opening line and the last 6 moves.
    const deduped: typeof rows = [];
    for (const row of rows) {
        const prev = deduped[deduped.length - 1];
        if (!prev || row.away_Odds !== prev.away_Odds || row.home_Odds !== prev.home_Odds || totalKey(totalOf(row)) !== totalKey(totalOf(prev))) deduped.push(row);
    }
    const selected = [deduped[0], ...deduped.slice(1).slice(-6)];

    const entries: OddsEntry[] = selected.map((row, i) => {
        const prev = i === 0 ? null : selected[i - 1];
        const total = totalOf(row);
        const prevTotal = prev ? totalOf(prev) : null;
        return {
            timestamp: row.timestamp_utc || row.timestamp,
            awayOdds: row.away_Odds,
            homeOdds: row.home_Odds,
            awayDir: prev ? dir(row.away_Odds, prev.away_Odds) : null,
            homeDir: prev ? dir(row.home_Odds, prev.home_Odds) : null,
            isOpen: i === 0,
            isLatest: i === selected.length - 1 && i > 0,
            total,
            totalDir: total && prevTotal ? (Number(total.line) > Number(prevTotal.line) ? 'up' : Number(total.line) < Number(prevTotal.line) ? 'down' : null) : null,
        };
    });

    return NextResponse.json({ entries }, { headers });
}
