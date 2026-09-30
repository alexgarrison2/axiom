import { TEAM_CODES } from '@/components/ui/team-color';
import { buildCards, groupByGames, type GameRef, type RawNewsItem } from './model';
import type { FeedGroup } from './NewsFeed';

import { formatTimeET } from '@/lib/format/time';

/** "Sep 29, 7:30 PM EDT": Eastern, the same server text <LocalTime> renders before it swaps to the viewer's zone. */
export function etLabel(at: string): string {
    if (!at) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
        return new Date(`${at}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return at;
    return formatTimeET(d, 'datetime') ?? at;
}

export function etTime(at: string | null): string | null {
    if (!at) return null;
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    return formatTimeET(d, 'time');
}

export function toFeedGroups(byTeam: Record<string, RawNewsItem[]>, games: GameRef[]): FeedGroup[] {
    const cards = buildCards(byTeam, new Set(TEAM_CODES));
    return groupByGames(cards, games).map(g => ({
        ...g,
        startLabel: g.game ? etTime(g.game.startUtc) : null,
        cards: g.cards.map(c => ({ ...c, updates: c.updates.map(u => ({ ...u, label: etLabel(u.at) })) })),
    }));
}
