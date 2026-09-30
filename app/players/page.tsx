import type { Metadata } from 'next';
import { readPublicJson } from '@/components/views/read-data';
import { PageHeading } from '@/components/ui/page-heading';
import SkaterStatsTable from '@/components/SkaterStatsTable';
import { compactSkaters, filterSkaters, sortSkaters } from '@/components/players/model';
import { SEASON_START_YEAR } from '@/lib/season';

export const revalidate = 3600;

// Player models rebuild once the league has played this many games
// (pipeline/season.py PLAYER_MODEL_MIN_GAMES); until then last season's
// ratings stay in use.
const PLAYER_MODEL_MIN_GAMES = 240;
const label = (start: number) => `${start}-${String(start + 1).slice(2)}`;

export const metadata: Metadata = {
    title: 'Players',
    description: 'NHL skater impact ratings: even-strength offence and defence, power play and penalty kill, adjusted for linemates and opponents.',
    alternates: { canonical: '/players' },
};

const readJson = readPublicJson;

export default function PlayersPage() {
    const all = compactSkaters(readJson('player_impact.json'), readJson('player_bio.json'));
    // Same default view as the client table: impact, 20+ GP, rostered players.
    const defaults = sortSkaters(filterSkaters(all, { q: '', team: 'all', pos: 'all', minGp: 20, rookies: false, includeOffRoster: false }), 'impact', 'desc');
    const preview = { rows: defaults.slice(0, 50), total: defaults.length };
    const manifest = readJson('manifest.json') as { games_played_current_season?: number } | null;
    const leagueGames = typeof manifest?.games_played_current_season === 'number' ? manifest.games_played_current_season : 0;
    const ratingsCurrent = leagueGames >= PLAYER_MODEL_MIN_GAMES;
    const ratingsSeason = label(ratingsCurrent ? SEASON_START_YEAR : SEASON_START_YEAR - 1);

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-5 md:px-6 md:py-7">
                <PageHeading title="Players" tag={ratingsCurrent ? undefined : <abbr title={`Ratings from the ${ratingsSeason} season until ~${PLAYER_MODEL_MIN_GAMES} league games are played${leagueGames ? ` (${leagueGames} so far)` : ''}`} className="no-underline">{ratingsSeason.slice(2)}</abbr>} />
                <SkaterStatsTable preview={preview} src="/players/skaters" />
            </div>
        </main>
    );
}
