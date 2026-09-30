/**
 * News feed shaping for /news: de-duplicate, collapse same-player updates into
 * one card with a timeline, tag, and group under tonight's matchups.
 * Pure — runs on the server and in tests.
 */

export interface RawNewsItem {
    player: string;
    news: string;
    category?: string;
    date?: string;
    timestamp?: string;
}

export type NewsKind = 'goalie' | 'injury' | 'returning' | 'lineup' | 'transaction' | 'other';
export type NewsFilter = 'all' | 'goalies' | 'injuries' | 'lineups';

export interface NewsUpdate {
    text: string;
    category: string;
    kind: NewsKind;
    /** ISO timestamp (UTC) or YYYY-MM-DD. */
    at: string;
}

export interface NewsCard {
    id: string;
    player: string;
    team: string;
    /** Newest first. */
    updates: NewsUpdate[];
    kind: NewsKind;
}

export interface GameRef {
    id: string | number;
    home: string;
    away: string;
    startUtc: string | null;
    /** When each team's previous game ended (ISO UTC), if known. Older items are not filed under this game. */
    prevEndUtc?: Partial<Record<string, string | null>>;
    /** Full team names by tricode (for "references the opponent"). */
    names?: Partial<Record<string, string>>;
}

/** Is the card's newest update about this game (posted after the team's last game, or naming the opponent)? */
export function isForGame(card: NewsCard, g: GameRef): boolean {
    const prevEnd = g.prevEndUtc?.[card.team];
    if (!prevEnd) return true;
    const newest = card.updates[0];
    if (!newest) return false;
    const at = newest.at;
    const fresh = /^\d{4}-\d{2}-\d{2}$/.test(at)
        ? at > new Date(prevEnd).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        : Date.parse(at) >= Date.parse(prevEnd);
    if (fresh) return true;
    const opp = card.team === g.home ? g.away : g.home;
    const oppName = g.names?.[opp];
    const text = newest.text;
    return new RegExp(`\\b${opp}\\b`).test(text) || (!!oppName && text.toLowerCase().includes(oppName.toLowerCase()));
}

export interface NewsGroup {
    key: string;
    title: string;
    game: GameRef | null;
    cards: NewsCard[];
}

const RETURNING = /\b(will|expected to|set to|is going to|plans to|should) (play|return|dress|suit up|be in the lineup)\b|\breturn(s|ing)? (to|from) (the )?(lineup|action|ice)\b|\bactivated\b|\bcleared (to play|for)\b|\bback in the lineup\b/i;
const NOT_PLAYING = /\b(won't|will not|isn't expected to|is not expected to|unlikely to|not) (play|return|dress|be in the lineup)\b|\bwill miss\b|\bruled out\b|\bout (for|until|indefinitely)\b|\bno timeline\b/i;

export function classify(category: string | undefined, text: string): NewsKind {
    const c = (category ?? '').toLowerCase();
    if (c.includes('goalie')) return 'goalie';
    if (c.includes('injur') || c.includes('ir ') || c === 'ir') {
        return RETURNING.test(text) && !NOT_PLAYING.test(text) ? 'returning' : 'injury';
    }
    if (/line|scratch|lineup|recall|call.?up|send down|sent down|assign|waiv/.test(c)) return 'lineup';
    if (/sign|trade|contract|claim|release|retire/.test(c)) return 'transaction';
    if (RETURNING.test(text) && !NOT_PLAYING.test(text) && /\((upper|lower|foot|knee|hand|illness|undisclosed|[a-z-]+)\)/i.test(text)) return 'returning';
    return 'other';
}

export function matchesFilter(kind: NewsKind, f: NewsFilter): boolean {
    if (f === 'all') return true;
    if (f === 'goalies') return kind === 'goalie';
    if (f === 'injuries') return kind === 'injury' || kind === 'returning';
    return kind === 'lineup';
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Build one card per player (per team), newest update first. */
export function buildCards(byTeam: Record<string, RawNewsItem[]>, validTeams?: Set<string>): NewsCard[] {
    const cards = new Map<string, NewsCard>();
    for (const [team, items] of Object.entries(byTeam ?? {})) {
        if (validTeams && !validTeams.has(team)) continue;
        for (const it of items ?? []) {
            if (!it || typeof it.player !== 'string' || typeof it.news !== 'string' || !it.news.trim()) continue;
            const key = `${team}:${norm(it.player)}`;
            const card = cards.get(key) ?? { id: key, player: it.player.trim(), team, updates: [], kind: 'other' as NewsKind };
            const upd: NewsUpdate = {
                text: it.news.trim(),
                category: it.category?.trim() || 'News',
                kind: classify(it.category, it.news),
                at: it.timestamp || it.date || '',
            };
            // Drop exact repeats (same text), keep distinct updates as a timeline.
            if (!card.updates.some(u => norm(u.text) === norm(upd.text))) card.updates.push(upd);
            cards.set(key, card);
        }
    }
    for (const c of cards.values()) {
        c.updates.sort((a, b) => b.at.localeCompare(a.at));
        c.kind = c.updates[0]?.kind ?? 'other';
    }
    return [...cards.values()].sort((a, b) => (b.updates[0]?.at ?? '').localeCompare(a.updates[0]?.at ?? ''));
}

/** Tonight's matchups first (both teams' cards), then the rest of the league. */
export function groupByGames(cards: NewsCard[], games: GameRef[]): NewsGroup[] {
    const used = new Set<string>();
    const groups: NewsGroup[] = [];
    const sorted = [...games].sort((a, b) => (a.startUtc ?? '').localeCompare(b.startUtc ?? '') || a.away.localeCompare(b.away));
    for (const g of sorted) {
        const list = cards.filter(c => !used.has(c.id) && (c.team === g.away || c.team === g.home) && isForGame(c, g));
        list.forEach(c => used.add(c.id));
        groups.push({ key: `game-${g.id}`, title: `${g.away} @ ${g.home}`, game: g, cards: list });
    }
    const rest = cards.filter(c => !used.has(c.id));
    if (rest.length) groups.push({ key: 'rest', title: games.length ? 'Rest of league' : 'Around the league', game: null, cards: rest });
    return groups;
}

export const KIND_LABEL: Record<NewsKind, string> = {
    goalie: 'Goalie',
    injury: 'Injury',
    returning: 'Returning',
    lineup: 'Lineup',
    transaction: 'Transaction',
    other: 'News',
};
