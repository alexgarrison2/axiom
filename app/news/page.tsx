import type { Metadata } from 'next';
import { readPublicJson } from '@/components/views/read-data';
import { PageHeading } from '@/components/ui/page-heading';
import { NewsFeed } from '@/components/news/NewsFeed';
import { toFeedGroups } from '@/components/news/feed';
import type { GameRef, RawNewsItem } from '@/components/news/model';
import fs from 'node:fs';
import path from 'node:path';
import { SEASON_ID } from '@/lib/season';
import { TEAM_NAMES } from '@/components/ui/team-color';

/** When each team's latest finished game (before `beforeUtc`) ended, from the pipeline's season schedule. */
function prevGameEnds(beforeUtc: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pipeline', 'data', `nhl_schedule_${SEASON_ID}.json`), 'utf8')) as {
            games?: Record<string, { start_utc?: string; home_abbrev?: string; away_abbrev?: string; state?: string }>;
        };
        const cutoff = beforeUtc ? Date.parse(beforeUtc) : Date.now();
        for (const g of Object.values(raw.games ?? {})) {
            if (!g.start_utc || (g.state !== 'FINAL' && g.state !== 'OFF') || Date.parse(g.start_utc) >= cutoff) continue;
            // A game is final about 2.5 hours after puck drop.
            const end = new Date(Date.parse(g.start_utc) + 2.5 * 3600 * 1000).toISOString();
            for (const t of [g.home_abbrev, g.away_abbrev]) if (t && (!out[t] || out[t] < end)) out[t] = end;
        }
    } catch {
        /* no schedule: every item stays eligible */
    }
    return out;
}

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
    const names = Object.fromEntries(Object.entries(TEAM_NAMES).map(([t, v]) => [t, v?.short ?? t]));
    const withPrev = games.map(g => {
        const ends = prevGameEnds(g.startUtc);
        return { ...g, names, prevEndUtc: { [g.home]: ends[g.home] ?? null, [g.away]: ends[g.away] ?? null } };
    });
    const groups = toFeedGroups(news, withPrev);
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
