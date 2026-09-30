import type { Metadata } from 'next';
import { readPublicJson } from '@/components/views/read-data';
import { PageHeading } from '@/components/ui/page-heading';
import { NewsFeed } from '@/components/news/NewsFeed';
import { toFeedGroups } from '@/components/news/feed';
import type { GameRef, RawNewsItem } from '@/components/news/model';

// News changes with every hourly pipeline run (each run redeploys).
export const revalidate = 900;

export const metadata: Metadata = {
    title: 'News',
    description: "Starting goalies, injuries and lineup news for tonight's NHL games, grouped by matchup.",
    alternates: { canonical: '/news' },
};

const readJson = readPublicJson;

/** Today's date in New York (the NHL's slate day). */
function todayEt(now = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface UpcomingGame {
    id?: number;
    gameDate?: string;
    startTimeUTC?: string;
    homeTeamAbbrev?: string;
    awayTeamAbbrev?: string;
    gameState?: string;
}

/** Tonight's games, or the next slate if nothing is scheduled today. */
function slate(upcoming: unknown): { games: GameRef[]; day: string | null } {
    const list = (Array.isArray(upcoming) ? upcoming : []) as UpcomingGame[];
    const today = todayEt();
    const days = [...new Set(list.map(g => g.gameDate).filter((d): d is string => !!d && d >= today))].sort();
    const day = days[0] ?? null;
    const games = list
        .filter(g => g.gameDate === day && g.homeTeamAbbrev && g.awayTeamAbbrev)
        .map(g => ({ id: g.id ?? `${g.awayTeamAbbrev}-${g.homeTeamAbbrev}`, home: g.homeTeamAbbrev!, away: g.awayTeamAbbrev!, startUtc: g.startTimeUTC ?? null }));
    return { games, day };
}

export default function NewsPage() {
    const news = (readJson('player_news.json') ?? {}) as Record<string, RawNewsItem[]>;
    const { games, day } = slate(readJson('upcoming_games.json'));
    const groups = toFeedGroups(news, games);
    const isToday = day === todayEt();
    const dayLabel = day
        ? isToday
            ? 'Tonight'
            : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
        : null;

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
                <PageHeading
                    eyebrow={dayLabel ? `${dayLabel} · ${games.length} ${games.length === 1 ? 'game' : 'games'}` : 'Around the league'}
                    title="News"
                    description="Starting goalies, injuries and lineup changes, grouped under the games they affect. Repeat reports on the same player are folded into one card."
                />
                <NewsFeed groups={groups} dayLabel={dayLabel} />
                <p className="text-caption text-fg-3">Source: DailyFaceoff. Times are Eastern.</p>
            </div>
        </main>
    );
}
