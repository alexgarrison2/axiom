import { NextResponse } from 'next/server';
import { getGame, validGameId } from '@/lib/game/fetch';

/**
 * One game's model for the team season views (lib/game/season.ts merges a
 * team's games in the browser). Official finals (OFF) never change, so they
 * are cached a year at the edge; anything else, a provisional FINAL included, a minute.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!validGameId(id)) return NextResponse.json({ error: 'bad game id' }, { status: 400 });
    let m;
    try {
        m = await getGame(id);
    } catch {
        // The NHL feed is down or slow: not a missing game, and nothing to cache.
        return NextResponse.json({ error: 'upstream unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!m) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=3600' } });
    // The season views need events, shifts, players and box; drop what only the game page shows.
    const pack = { ...m, events: m.events.map(e => ({ ...e, clip: null })), stars: [], odds: null, outlook: null, pregame: null, official: null };
    const final = m.settled && !m.xgPending;
    return NextResponse.json(pack, {
        headers: { 'Cache-Control': final ? 'public, s-maxage=31536000, stale-while-revalidate=86400' : 'public, s-maxage=60' },
    });
}
