import { TEAM_CODES } from '@/components/ui/team-color';
import { buildCards, groupByGames, type GameRef, type RawNewsItem } from './model';
import type { FeedGroup } from './NewsFeed';

const ET = 'America/New_York';

/** "Sep 29, 2:48 PM ET" — fixed zone so server and client render the same text. */
export function etLabel(at: string): string {
    if (!at) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
        return new Date(`${at}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return at;
    return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ET })} ET`;
}

export function etTime(at: string | null): string | null {
    if (!at) return null;
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET })} ET`;
}

export function toFeedGroups(byTeam: Record<string, RawNewsItem[]>, games: GameRef[]): FeedGroup[] {
    const cards = buildCards(byTeam, new Set(TEAM_CODES));
    return groupByGames(cards, games).map(g => ({
        ...g,
        startLabel: g.game ? etTime(g.game.startUtc) : null,
        cards: g.cards.map(c => ({ ...c, updates: c.updates.map(u => ({ ...u, label: etLabel(u.at) })) })),
    }));
}
