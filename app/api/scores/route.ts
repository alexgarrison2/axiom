import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '@/types/prediction';
import type { LiveGame } from '@/lib/matchup/lifecycle';

/**
 * Live scores for one slate day: a trimmed proxy of the NHL
 * api-web /v1/score/{date} feed (same-origin, so the CSP stays 'self').
 * Cached 20s in the Data Cache and at the edge.
 *
 *   GET /api/scores?date=2026-09-30  →  { date, fetchedAt, games: LiveGame[] }
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set<GameState>(['FUT', 'PRE', 'LIVE', 'CRIT', 'FINAL', 'OFF']);

interface NhlSide {
    abbrev?: string;
    score?: number;
    sog?: number;
}

interface NhlGame {
    id?: number;
    gameState?: string;
    period?: number;
    periodDescriptor?: { number?: number; periodType?: string };
    clock?: { timeRemaining?: string; inIntermission?: boolean };
    gameOutcome?: { lastPeriodType?: string };
    awayTeam?: NhlSide;
    homeTeam?: NhlSide;
}

function validDate(s: string | null): s is string {
    if (!s || !DATE_RE.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function trimGame(g: NhlGame): LiveGame | null {
    if (!g?.id) return null;
    const state = (STATES.has(g.gameState as GameState) ? g.gameState : 'FUT') as GameState;
    const started = state !== 'FUT' && state !== 'PRE';
    return {
        id: String(g.id),
        state,
        period: started ? n(g.periodDescriptor?.number ?? g.period) : null,
        periodType: started ? g.periodDescriptor?.periodType ?? null : null,
        clock: started ? g.clock?.timeRemaining ?? null : null,
        intermission: !!g.clock?.inIntermission,
        lastPeriodType: g.gameOutcome?.lastPeriodType ?? null,
        away: { score: started ? n(g.awayTeam?.score) : null, sog: started ? n(g.awayTeam?.sog) : null },
        home: { score: started ? n(g.homeTeam?.score) : null, sog: started ? n(g.homeTeam?.sog) : null },
    };
}

export async function GET(request: NextRequest) {
    const date = request.nextUrl.searchParams.get('date');
    if (!validDate(date)) {
        return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    try {
        const res = await fetch(`https://api-web.nhle.com/v1/score/${date}`, {
            next: { revalidate: 20 },
            signal: AbortSignal.timeout(6000),
            headers: { 'User-Agent': 'pony-xg (live scores)' },
        });
        if (!res.ok) return NextResponse.json({ error: 'upstream', status: res.status }, { status: 502 });
        const body = (await res.json()) as { games?: NhlGame[] };
        const games = (body.games ?? []).map(trimGame).filter((g): g is LiveGame => g !== null);
        return NextResponse.json(
            { date, fetchedAt: new Date().toISOString(), games },
            { headers: { 'Cache-Control': 'public, max-age=10, s-maxage=20, stale-while-revalidate=40' } },
        );
    } catch {
        return NextResponse.json({ error: 'upstream unavailable' }, { status: 502 });
    }
}
