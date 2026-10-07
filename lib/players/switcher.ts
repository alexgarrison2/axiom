/**
 * The player switcher's index (GET /api/players-index, built by
 * switcher-server.ts) and its pure helpers: decoding, accent-insensitive name
 * search, a team's current roster grouped for the default list, and the link
 * that keeps ?season= when the target played that season. No fs: shared by the
 * route and the client component.
 */

/** One row: [id, first, last, team, pos, number, flags, headshot override]. */
export type IndexRow = [number, string, string, string, string, number | null, number, string?];

export interface PlayersIndexDoc {
    /** Pony seasons, newest first; flag bit i means the player has games in seasons[i]. */
    seasons: string[];
    /** The current season id (headshots default to its mugs). */
    cur: string;
    players: IndexRow[];
}

/** Flag bit for a current NHL roster spot (above the season bits). */
export const ROSTER_BIT = 1 << 8;

export interface IndexPlayer {
    id: number;
    first: string;
    last: string;
    /** Current team, else the last team he played for in the index's seasons. */
    team: string;
    pos: string;
    num: number | null;
    /** Pony seasons with games. */
    seasons: string[];
    rostered: boolean;
    headshot: string;
    /** Normalised names for search. */
    nFirst: string;
    nLast: string;
}

const mug = (season: string, team: string, id: number) => `https://assets.nhle.com/mugs/nhl/${season}/${team}/${id}.png`;

/** The headshot the index would derive for a row (an override is stored only when the real one differs). */
export function defaultHeadshot(doc: Pick<PlayersIndexDoc, 'seasons' | 'cur'>, id: number, team: string, flags: number): string {
    const season = flags & ROSTER_BIT || flags & 1 ? doc.cur : (doc.seasons.find((_, i) => flags & (1 << i)) ?? doc.cur);
    return mug(season, team, id);
}

export function decodeIndex(doc: PlayersIndexDoc): IndexPlayer[] {
    return doc.players.map(([id, first, last, team, pos, num, flags, hs]) => ({
        id,
        first,
        last,
        team,
        pos,
        num,
        seasons: doc.seasons.filter((_, i) => flags & (1 << i)),
        rostered: (flags & ROSTER_BIT) !== 0,
        headshot: hs || defaultHeadshot(doc, id, team, flags),
        nFirst: normalizeName(first),
        nLast: normalizeName(last),
    }));
}

// Letters NFD does not split into base + accent.
const FOLD: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Lower case, accents and apostrophes / periods dropped, hyphens as spaces, one space between words. */
export function normalizeName(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[øæœßłđðþı]/g, c => FOLD[c] ?? c)
        .replace(/['’‘`.]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Match tier for a normalised query, lower is better, null for no match:
 * 0 last name prefix, 1 first name or full name prefix, 2 every query word
 * starts a name word (any order), 3 substring anywhere in the name.
 */
export function matchTier(p: Pick<IndexPlayer, 'nFirst' | 'nLast'>, q: string): number | null {
    if (!q) return null;
    const qc = q.replace(/ /g, '');
    const full = `${p.nFirst} ${p.nLast}`;
    if (p.nLast.startsWith(q) || p.nLast.replace(/ /g, '').startsWith(qc)) return 0;
    if (p.nFirst.startsWith(q) || full.startsWith(q)) return 1;
    const words = full.split(' ');
    if (q.split(' ').every(t => words.some(w => w.startsWith(t)))) return 2;
    if (full.includes(q) || full.replace(/ /g, '').includes(qc)) return 3;
    return null;
}

/** Players matching `query`, best first: tier, then rostered, then last and first name. */
export function searchPlayers(players: IndexPlayer[], query: string, limit = 40): IndexPlayer[] {
    const q = normalizeName(query);
    if (!q) return [];
    const hits: { p: IndexPlayer; t: number }[] = [];
    for (const p of players) {
        const t = matchTier(p, q);
        if (t != null) hits.push({ p, t });
    }
    hits.sort(
        (a, b) =>
            a.t - b.t ||
            Number(b.p.rostered) - Number(a.p.rostered) ||
            a.p.nLast.localeCompare(b.p.nLast) ||
            a.p.nFirst.localeCompare(b.p.nFirst) ||
            a.p.id - b.p.id,
    );
    return hits.slice(0, limit).map(h => h.p);
}

export type RosterGroup = 'F' | 'D' | 'G';
export const GROUP_LABEL: Record<RosterGroup, string> = { F: 'Forwards', D: 'Defence', G: 'Goalies' };
export const groupOf = (pos: string): RosterGroup => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');

/** A team's rostered players by group, each by sweater number (no number last). */
export function teamRoster(players: IndexPlayer[], team: string | null): { group: RosterGroup; players: IndexPlayer[] }[] {
    if (!team) return [];
    const on = players.filter(p => p.rostered && p.team === team);
    return (['F', 'D', 'G'] as RosterGroup[])
        .map(group => ({
            group,
            players: on
                .filter(p => groupOf(p.pos) === group)
                .sort((a, b) => (a.num ?? 1000) - (b.num ?? 1000) || a.nLast.localeCompare(b.nLast)),
        }))
        .filter(g => g.players.length > 0);
}

/** /players/<id>, keeping ?season= only when he has games in that season. */
export function playerHref(p: Pick<IndexPlayer, 'id' | 'seasons'>, season: string | null): string {
    return season && p.seasons.includes(season) ? `/players/${p.id}?season=${season}` : `/players/${p.id}`;
}
