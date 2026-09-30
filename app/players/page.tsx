import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/page-heading';
import SkaterStatsTable from '@/components/SkaterStatsTable';
import { compactSkaters } from '@/components/players/model';
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

function readJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', file), 'utf8'));
    } catch {
        return null;
    }
}

export default function PlayersPage() {
    const players = compactSkaters(readJson('player_impact.json'), readJson('player_bio.json'));
    const manifest = readJson('manifest.json') as { games_played_current_season?: number } | null;
    const leagueGames = typeof manifest?.games_played_current_season === 'number' ? manifest.games_played_current_season : 0;
    const ratingsCurrent = leagueGames >= PLAYER_MODEL_MIN_GAMES;
    const ratingsSeason = label(ratingsCurrent ? SEASON_START_YEAR : SEASON_START_YEAR - 1);

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
                <PageHeading
                    eyebrow={`${label(SEASON_START_YEAR)} season · skaters`}
                    title="Players"
                    description="Who moves the needle: each skater's impact on goals for and against, adjusted for linemates and opponents, next to his scoring."
                    actions={
                        <span
                            className={
                                ratingsCurrent
                                    ? 'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-caption font-semibold text-fg-1'
                                    : 'is-stale inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-semibold'
                            }
                        >
                            <span className="rounded-[3px] bg-fg-3/15 px-1 font-mono text-micro text-fg-2">{ratingsSeason.slice(2)}</span>
                            Ratings: {ratingsSeason}
                            {ratingsCurrent ? '' : ` · refresh after ~${PLAYER_MODEL_MIN_GAMES} league games${leagueGames ? ` (${leagueGames} played)` : ''}`}
                        </span>
                    }
                />
                <SkaterStatsTable players={players} ratingsLabel={ratingsCurrent ? `${ratingsSeason} season` : `${ratingsSeason} season (teams updated for offseason moves)`} />
            </div>
        </main>
    );
}
