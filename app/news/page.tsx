import type { Metadata } from 'next';
import { readPublicJson } from '@/components/views/read-data';
import { NewsFeed } from '@/components/news/NewsFeed';
import { toFeedGroups } from '@/components/news/feed';
import type { GameRef, RawNewsItem } from '@/components/news/model';
import fs from 'node:fs';
import path from 'node:path';
import { SEASON_ID } from '@/lib/season';
import { slateDate } from '@/lib/matchup/format';
import { TEAM_NAMES } from '@/components/ui/team-color';

interface ScheduleGame {
    start_utc?: string;
    home_abbrev?: string;
    away_abbrev?: string;
    state?: string;
}

/** The pipeline's season schedule, read once per render ([] if missing: every item stays eligible). */
function seasonSchedule(): ScheduleGame[] {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pipeline', 'data', `nhl_schedule_${SEASON_ID}.json`), 'utf8')) as {
            games?: Record<string, ScheduleGame>;
        };
        return Object.values(raw.games ?? {});
    } catch {
        return [];
    }
}

/** When each team's latest finished game (before `beforeUtc`) ended. */
function prevGameEnds(schedule: ScheduleGame[], beforeUtc: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    const cutoff = beforeUtc ? Date.parse(beforeUtc) : Date.now();
    for (const g of schedule) {
        const start = g.start_utc ? Date.parse(g.start_utc) : NaN;
        if (!Number.isFinite(start) || start >= cutoff) continue;
        // Final per the schedule, or started 4h+ ago (the schedule file can lag a refresh).
        if (g.state !== 'FINAL' && g.state !== 'OFF' && start + 4 * 3600 * 1000 > Date.now()) continue;
        // A game is final about 2.5 hours after puck drop.
        const end = new Date(start + 2.5 * 3600 * 1000).toISOString();
        for (const t of [g.home_abbrev, g.away_abbrev]) if (t && (!out[t] || out[t] < end)) out[t] = end;
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

interface UpcomingGame {
    id?: number;
    gameDate?: string;
    startTimeUTC?: string;
    homeTeamAbbrev?: string;
    awayTeamAbbrev?: string;
    gameState?: string;
}

/** Tonight's games, or the next slate if nothing is scheduled today. */
function slate(upcoming: unknown, today: string): { games: GameRef[]; day: string | null } {
    const list = (Array.isArray(upcoming) ? upcoming : []) as UpcomingGame[];
    const days = [...new Set(list.map(g => g.gameDate).filter((d): d is string => !!d && d >= today))].sort();
    const day = days[0] ?? null;
    const games = list
        .filter(g => g.gameDate === day && g.homeTeamAbbrev && g.awayTeamAbbrev)
        .map(g => ({ id: g.id ?? `${g.awayTeamAbbrev}-${g.homeTeamAbbrev}`, home: g.homeTeamAbbrev!, away: g.awayTeamAbbrev!, startUtc: g.startTimeUTC ?? null }));
    return { games, day };
}

export default function NewsPage() {
    const news = (readJson('player_news.json') ?? {}) as Record<string, RawNewsItem[]>;
    // The current slate (Eastern, rolling over at 3:00 am ET, as on home).
    const today = slateDate();
    const { games, day } = slate(readJson('upcoming_games.json'), today);
    const names = Object.fromEntries(Object.entries(TEAM_NAMES).map(([t, v]) => [t, v?.short ?? t]));
    const schedule = seasonSchedule();
    const withPrev = games.map(g => {
        const ends = prevGameEnds(schedule, g.startUtc);
        return { ...g, names, prevEndUtc: { [g.home]: ends[g.home] ?? null, [g.away]: ends[g.away] ?? null } };
    });
    // Starter/lineup notes about games that have since gone final are dropped.
    const groups = toFeedGroups(news, withPrev, prevGameEnds(schedule, null));
    const isToday = day === today;
    const dayLabel = day
        ? isToday
            ? 'Tonight'
            : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()
        : null;

    return (
        <main className="pb-tabbar">
            <div className="page py-5 md:py-7">
                <NewsFeed groups={groups} dayLabel={dayLabel} />
            </div>
        </main>
    );
}
