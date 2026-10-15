/*
 * Player milestones (public/data/milestones.json, pipeline/milestones.py):
 * types, the one-line copy for each milestone and the board's order. Pure,
 * safe on the server and the client.
 */
import { TEAM_NAMES } from '@/components/ui/team-color';
import { fmtInt } from '@/components/views/format';

export type Kind = 'career' | 'alltime' | 'franchise' | 'streak' | 'season' | 'pony';
export type Stat =
    | 'gp' | 'g' | 'a' | 'p' | 'ppg' | 'ppp' | 'gwg' | 'sog' | 'hit' | 'blk' | 'fow'
    | 'w' | 'so' | 'sv' | 'ixg' | 'pstreak' | 'gstreak' | 'ironman';

/** [gameId, date, opponent, home (1/0), team game number] */
export type Eta = [number, string, string, number, number];
/** [id, name, value, hall of famer (1/0), on a current roster (1/0)] */
export type Who = [number, string, number, number, number];
/** [rank, id, name, value, hall of famer (1/0), others tied at that value, games played on that list] */
export type LadderRow = [number, number, string, number, number, number, number?];

export interface Milestone {
    p: number;
    kind: Kind;
    stat: Stat;
    have: number;
    target: number;
    need: number;
    /** Per-game pace behind the projection. */
    rate: number;
    eta: Eta;
    /** Within one game's reach. */
    one?: 1;
    /** Games behind the pace when fewer than 10 (thin). */
    n?: number;
    /** Players in NHL history (pony: since the shot archive) at or past the target. */
    club?: number;
    /** The place he takes: club plus the chasers projected to get there first. */
    nth?: number;
    /** Shares the place with another player projected for the same night. */
    tie?: 1;
    /** All-time or franchise rank he takes by passing `who`. */
    rank?: number;
    who?: Who;
    tied?: number;
    /** The list around a pass, best first: up to two places above the name he passes, then that name. */
    ladder?: LadderRow[];
    /** His place on that list today. */
    now?: number;
    /** The names between that one and him, nearest him last (at most two). */
    between?: LadderRow[];
    /** Further names between that are not shown. */
    gap?: number;
    /** Breaking into this list's top N (all-time 100 or 50, franchise 10). */
    entry?: number;
    /** His games played on that list (career, or with the franchise). */
    ngp?: number;
    /** Franchise (current club tricode). */
    fr?: string;
    /** Season's longest streak (iron man: longest active): [games, player id, name]. */
    best?: [number, number, string];
    pace?: number;
    race?: 1;
}

export interface Recent {
    p: number;
    stat: Stat;
    target: number;
    date: string;
    game: number;
    opp: string;
    club: number;
}

/** [first, last, position, team, injury tag (IR / DTD / OUT) or null] */
export type PlayerRow = [string, string, string, string, string | null];
/** [gameId, date, startUTC, opponent, home (1/0)] */
export type NextGame = [number, string, string | null, string, number];

export interface MilestonesDoc {
    season: string;
    built_at: string;
    since_ixg: number | null;
    players: Record<string, PlayerRow>;
    next: Record<string, NextGame>;
    items: Milestone[];
    recent: Recent[];
}

export function parseMilestones(raw: unknown): MilestonesDoc | null {
    const d = raw as Partial<MilestonesDoc> | null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items) || !d.players || !d.next) return null;
    return {
        season: String(d.season ?? ''),
        built_at: String(d.built_at ?? ''),
        since_ixg: typeof d.since_ixg === 'number' ? d.since_ixg : null,
        players: d.players,
        next: d.next,
        items: d.items,
        recent: Array.isArray(d.recent) ? d.recent : [],
    };
}

// ── Copy ────────────────────────────────────────────────────────────────────

const STAT: Record<Stat, { one: string; many: string; list: string }> = {
    gp: { one: 'game', many: 'games', list: 'games' },
    g: { one: 'goal', many: 'goals', list: 'goals' },
    a: { one: 'assist', many: 'assists', list: 'assists' },
    p: { one: 'point', many: 'points', list: 'points' },
    ppg: { one: 'PP goal', many: 'PP goals', list: 'power-play goals' },
    ppp: { one: 'PP point', many: 'PP points', list: 'power-play points' },
    gwg: { one: 'game-winner', many: 'game-winners', list: 'game-winning goals' },
    sog: { one: 'shot', many: 'shots', list: 'shots' },
    hit: { one: 'hit', many: 'hits', list: 'hits' },
    blk: { one: 'block', many: 'blocks', list: 'blocked shots' },
    fow: { one: 'faceoff win', many: 'faceoff wins', list: 'faceoff wins' },
    w: { one: 'win', many: 'wins', list: 'wins' },
    so: { one: 'shutout', many: 'shutouts', list: 'shutouts' },
    sv: { one: 'save', many: 'saves', list: 'saves' },
    ixg: { one: 'ixG', many: 'ixG', list: 'ixG' },
    pstreak: { one: 'game', many: 'games', list: 'point streak' },
    gstreak: { one: 'game', many: 'games', list: 'goal streak' },
    ironman: { one: 'game', many: 'games', list: 'games-played streak' },
};

/** Column head for a list's value: "PTS", "G", "W". */
export const STAT_ABBR: Record<Stat, string> = {
    gp: 'GP', g: 'G', a: 'A', p: 'PTS', ppg: 'PPG', ppp: 'PPP', gwg: 'GWG', sog: 'SOG', hit: 'HIT', blk: 'BLK',
    fow: 'FOW', w: 'W', so: 'SO', sv: 'SV', ixg: 'ixG', pstreak: 'GP', gstreak: 'GP', ironman: 'GP',
};

export const KINDS: { key: Kind | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'career', label: 'Career' },
    { key: 'alltime', label: 'All-time' },
    { key: 'franchise', label: 'Franchise' },
    { key: 'streak', label: 'Streaks' },
    { key: 'season', label: 'Season' },
    { key: 'pony', label: 'pony xG' },
];

export function ordinal(n: number): string {
    const r = n % 100;
    const s = r >= 11 && r <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
    return `${fmtInt(n)}${s}`;
}

/** "Wayne Gretzky" -> "Gretzky" (keeps "van Riemsdyk", "St. Louis"). */
export function lastName(full: string): string {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) return full;
    const lower = parts.findIndex((w, i) => i > 0 && (/^(van|von|de|der|di|da|le|la|st\.?)$/i.test(w)));
    return parts.slice(lower > 0 ? lower : parts.length - 1).join(' ');
}

const place = (m: Milestone, n: number) => `${m.tie ? 'T-' : ''}${ordinal(n)}`;

const num = (v: number, stat: Stat) => (stat === 'ixg' ? v.toFixed(v < 10 ? 2 : 1) : fmtInt(v));

/** "3 goals", "1 game", "0.26 ixG". */
export function needText(m: Pick<Milestone, 'need' | 'stat'>): string {
    const s = STAT[m.stat];
    return `${num(m.need, m.stat)} ${m.need === 1 ? s.one : s.many}`;
}

/** The unit under a countdown number: "goals", "game". */
export function needUnit(m: Pick<Milestone, 'need' | 'stat'>): string {
    const s = STAT[m.stat];
    return m.need === 1 ? s.one : s.many;
}

const teamShort = (tri: string) => TEAM_NAMES[tri]?.short ?? tri;

export interface Copy {
    /** The milestone itself: "500 goals", "Pass Gilmour", "Lightning record". */
    title: string;
    /** What it means: "47th ever", "21st all-time in points". */
    context: string;
    hof: boolean;
}

/** The milestone in words. `sinceTag` is the shot archive's first season ("22-23"). */
export function describe(m: Milestone, sinceTag: string | null): Copy {
    const s = STAT[m.stat];
    const who = m.who;
    const hof = !!who?.[3];
    const others = m.tied ? ` +${m.tied}` : '';
    switch (m.kind) {
        case 'career':
        {
            const nth = m.nth ?? (m.club ?? 0) + 1;
            return { title: `${fmtInt(m.target)} ${s.many}`, context: `${nth === 1 && !m.tie ? 'First ever' : `${place(m, nth)} ever`} · has ${fmtInt(m.have)}`, hof: false };
        }
        case 'pony':
            return {
                title: `${fmtInt(m.target)} ixG`,
                context: `${place(m, m.nth ?? (m.club ?? 0) + 1)} since ${sinceTag ?? 'start'} · has ${m.have.toFixed(1)}`,
                hof: false,
            };
        case 'alltime':
            if (m.entry) return { title: `All-time top ${m.entry}`, context: `${cap(s.list)} · passes ${lastName(who?.[1] ?? '')}`, hof };
            return { title: `Pass ${lastName(who?.[1] ?? '')}${others}`, context: `${place(m, m.rank ?? 0)} all-time in ${s.list}`, hof };
        case 'franchise':
            if (m.rank === 1 && !m.tie) {
                return { title: `${teamShort(m.fr ?? '')} record`, context: `Most ${s.list}`, hof };
            }
            if (m.entry) return { title: `${teamShort(m.fr ?? '')} top ${m.entry}`, context: `${cap(s.list)} · passes ${lastName(who?.[1] ?? '')}`, hof };
            return { title: `Pass ${lastName(who?.[1] ?? '')}${others}`, context: `${place(m, m.rank ?? 0)} in ${teamShort(m.fr ?? '')} ${s.list}`, hof };
        case 'streak': {
            const best = m.best;
            if (m.stat === 'ironman') {
                const context = !best ? 'Iron-man streak' : best[1] === m.p ? 'Longest active' : `Longest active ${fmtInt(best[0])} · ${lastName(best[2])}`;
                return { title: `${fmtInt(m.target)} straight games`, context, hof: false };
            }
            const kind = m.stat === 'gstreak' ? 'goal' : 'point';
            const context = !best ? `Active ${kind} streak` : best[1] === m.p ? 'Season’s longest' : `Season best ${best[0]} · ${lastName(best[2])}`;
            return { title: `${m.target}-game ${kind} streak`, context, hof: false };
        }
        case 'season':
            if (m.race) return { title: `First to ${fmtInt(m.target)}`, context: `${cap(s.many)} this season`, hof: false };
            return { title: `${fmtInt(m.target)} ${s.many}`, context: `On pace for ${fmtInt(m.pace ?? 0)}`, hof: false };
    }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ── Order ───────────────────────────────────────────────────────────────────

/** Smaller = rarer: club size for round numbers, list rank for passes. */
export function rarity(m: Milestone): number {
    switch (m.kind) {
        case 'career':
            return m.club ?? 9999;
        case 'pony':
            return (m.club ?? 999) * 4 + 20;
        case 'alltime':
            return (m.rank ?? 100) * (m.who?.[3] ? 0.8 : 1);
        case 'franchise':
            return m.rank === 1 ? 3 : (m.rank ?? 10) * 12;
        case 'streak':
            return m.stat === 'ironman' ? 40 - m.target / 25 : 60 - m.target;
        case 'season':
            return m.race ? 30 : 80;
    }
}

export type Sort = 'soon' | 'rare';

export function sortMilestones(items: Milestone[], sort: Sort): Milestone[] {
    const out = items.slice();
    if (sort === 'rare') out.sort((a, b) => rarity(a) - rarity(b) || a.eta[1].localeCompare(b.eta[1]) || a.need - b.need);
    else out.sort((a, b) => a.eta[1].localeCompare(b.eta[1]) || rarity(a) - rarity(b) || a.need - b.need);
    return out;
}

export function filterMilestones(doc: Pick<MilestonesDoc, 'players'>, items: Milestone[], kind: Kind | 'all', query: string): Milestone[] {
    const q = query.trim().toLowerCase();
    return items.filter(m => {
        if (kind !== 'all' && m.kind !== kind) return false;
        if (!q) return true;
        const p = doc.players[String(m.p)];
        if (!p) return false;
        return `${p[0]} ${p[1]}`.toLowerCase().includes(q) || p[3].toLowerCase() === q;
    });
}

/** Worth the opening panel: not a round number hundreds of players already have. */
export function headline(m: Milestone): boolean {
    if (m.kind === 'career') return (m.club ?? 0) < 1000;
    if (m.kind === 'pony') return (m.club ?? 0) < 100;
    return true;
}

/** Recent round numbers, rarest first. */
export function notableRecent(recent: Recent[], limit: number): Recent[] {
    return recent.slice().sort((a, b) => a.club - b.club || b.date.localeCompare(a.date)).slice(0, limit);
}

/**
 * Milestones within one game's reach, projected for the player's very next
 * game, on the earliest such night: the board's opening panel.
 */
export function nextGameMilestones(doc: MilestonesDoc, limit = 8): { date: string | null; items: Milestone[]; total: number } {
    const due = doc.items.filter(m => {
        const team = doc.players[String(m.p)]?.[3];
        return m.one && team && doc.next[team]?.[0] === m.eta[0] && headline(m);
    });
    if (!due.length) return { date: null, items: [], total: 0 };
    const date = due.reduce((d, m) => (m.eta[1] < d ? m.eta[1] : d), due[0].eta[1]);
    const night = sortMilestones(due.filter(m => m.eta[1] === date), 'rare');
    // One per player: his rarest.
    const seen = new Set<number>();
    const firsts = night.filter(m => (seen.has(m.p) ? false : (seen.add(m.p), true)));
    // Everything projected for that night (the board's group for it), so both read the same count.
    return { date, items: firsts.slice(0, limit), total: doc.items.filter(m => m.eta[1] === date).length };
}

/** Countdown meter: 10 pips with `need` of them hollow, or a 0-1 bar when the gap is bigger or fractional. */
export function meter(m: Pick<Milestone, 'need' | 'have' | 'target' | 'stat' | 'kind'>): { pips: number; hollow: number } | { bar: number } {
    if (Number.isInteger(m.need) && m.need >= 1 && m.need <= 10) {
        if (m.kind === 'streak' && m.stat !== 'ironman') return { pips: m.target, hollow: m.need };
        return { pips: 10, hollow: m.need };
    }
    return { bar: m.target > 0 ? Math.max(0, Math.min(1, m.have / m.target)) : 0 };
}

/** "Thu, Oct 15" for an ISO date (no timezone shift). */
export function dayLabel(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "25-26" style tag for a season start year. */
export const seasonTag = (start: number | null) => (start == null ? null : `${String(start).slice(2)}-${String(start + 1).slice(2)}`);

export function headshot(season: string, team: string, id: number): string {
    return `https://assets.nhle.com/mugs/nhl/${season}/${team}/${id}.png`;
}
