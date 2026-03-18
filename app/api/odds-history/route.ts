import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export interface OddsEntry {
    timestamp: string;
    awayOdds: string;
    homeOdds: string;
    awayDir: 'up' | 'down' | null;
    homeDir: 'up' | 'down' | null;
    isOpen: boolean;
}

function parseOddsNum(odds: string): number {
    if (!odds) return 0;
    return parseInt(odds.replace(/[^-\d]/g, ''), 10) || 0;
}

function dir(curr: string, prev: string): 'up' | 'down' | null {
    const c = parseOddsNum(curr);
    const p = parseOddsNum(prev);
    if (c > p) return 'up';
    if (c < p) return 'down';
    return null;
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');
    const date = searchParams.get('date'); // YYYY-MM-DD

    if (!gameId || !date) {
        return NextResponse.json({ error: 'Missing gameId or date' }, { status: 400 });
    }

    const csvPath = path.join(process.cwd(), 'public', 'data', 'SiteHistory', `${date}.csv`);
    if (!fs.existsSync(csvPath)) {
        return NextResponse.json({ entries: [] });
    }

    const csv = fs.readFileSync(csvPath, 'utf-8');
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const rows = (parsed.data as Record<string, string>[])
        .filter(r => r.gameid === gameId && r.away_Odds && r.home_Odds);

    if (rows.length === 0) return NextResponse.json({ entries: [] });

    // Deduplicate consecutive identical odds pairs
    const deduped: typeof rows = [];
    for (const row of rows) {
        if (deduped.length === 0) {
            deduped.push(row);
        } else {
            const prev = deduped[deduped.length - 1];
            if (row.away_Odds !== prev.away_Odds || row.home_Odds !== prev.home_Odds) {
                deduped.push(row);
            }
        }
    }

    // Keep opening + last 6 changes
    const opening = deduped[0];
    const changes = deduped.slice(1);
    const recent = changes.slice(-6);
    const selected = opening ? [opening, ...recent] : recent;

    const entries: OddsEntry[] = selected.map((row, i) => {
        const prev = i === 0 ? null : selected[i - 1];
        return {
            timestamp: row.timestamp,
            awayOdds: row.away_Odds,
            homeOdds: row.home_Odds,
            awayDir: prev ? dir(row.away_Odds, prev.away_Odds) : null,
            homeDir: prev ? dir(row.home_Odds, prev.home_Odds) : null,
            isOpen: i === 0,
        };
    });

    return NextResponse.json({ entries });
}
