import { buildPlayersIndex } from '@/lib/players/switcher-server';

// The player switcher's search index (every player in the newest two Pony
// seasons plus current rosters), built once per deploy; the player page
// fetches it when the switcher is first hovered, focused or opened.
export const dynamic = 'force-static';

export async function GET() {
    const doc = await buildPlayersIndex();
    return Response.json(doc, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800' } });
}
