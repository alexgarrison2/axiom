import { NextResponse } from 'next/server';
import { loadPonySeason, playerGames, ponySeasons } from '@/lib/pony/data';
import type { Form } from '@/lib/players/form';

/**
 * One skater's games of a season (?season=20262027) for the /players row
 * drawer. Every pipeline commit redeploys, so an hour at the edge is safe.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const season = new URL(req.url).searchParams.get('season') ?? '';
    if (!/^\d{7}$/.test(id) || !ponySeasons().includes(season)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    const data = loadPonySeason(season);
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const form: Form = {
        season,
        games: playerGames(data, Number(id)).skater.map(r => {
            const g = data.games.get(r.game)!;
            return {
                game: r.game,
                date: r.date,
                opp: r.opp,
                home: r.home,
                result: r.result,
                gf: r.home ? g.homeScore : g.awayScore,
                ga: r.home ? g.awayScore : g.homeScore,
                g: r.g,
                a: r.a1 + r.a2,
                sog: r.sog,
                ixg: Math.round(r.ixg * 1000) / 1000,
                toi: r.toi,
                toiPp: r.toiPp,
                toiPk: r.toiPk,
                ps: Math.round(r.ps * 1000) / 1000,
                xgf5: r.box ? Math.round(r.box.xgf5 * 1000) / 1000 : null,
                xga5: r.box ? Math.round(r.box.xga5 * 1000) / 1000 : null,
            };
        }),
    };
    return NextResponse.json(form, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
}
