import { historySeasons, loadGradedGames } from '@/components/accuracy/data';
import { loadStarters } from '@/components/accuracy/starters';
import { dataCacheHeaders } from '@/lib/http-cache';
import { SEASON_START_YEAR } from '@/lib/season';

// Static JSON per season ("/accuracy/games/2025-26"), built from
// data/prediction_history.json, so the /accuracy HTML stays small and the
// browser loads a season's rows only when it is selected.
export const dynamic = 'force-static';
export const dynamicParams = false;

const CURRENT = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;

export function generateStaticParams() {
    const seasons = new Set([CURRENT, ...historySeasons(loadGradedGames())]);
    return [...seasons].map(season => ({ season }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ season: string }> }) {
    const { season } = await params;
    const starters = loadStarters(season);
    const rows = loadGradedGames()
        .filter(g => g.season === season)
        .map(g => {
            const s = starters.get(g.id);
            return s ? { ...g, homeGoalie: s.home, awayGoalie: s.away } : g;
        });
    return Response.json(rows, { headers: dataCacheHeaders(300, 3600) });
}
