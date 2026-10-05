/**
 * The /props board: types for public/data/props.json (pipeline/prop_board.py)
 * and the pure logic behind the table — categories, lines, hit rates, edge,
 * linemate boosts, filters and sorting.
 */

/** [date, opp, home, toi, g, a, sog, ppp, prevSeason, attempts] (attempts missing in older files) */
export type LogRow = [string, string, number, number, number, number, number, number, number, (number | null)?];

export interface BookPrice {
    over: number | null;
    under?: number | null;
    /** Implied P(over): de-vigged for two-way markets, raw (vig included) for one-way ones. */
    imp: number | null;
    devig: boolean;
}

export interface PropPlayer {
    id: number;
    name: string;
    team: string;
    pos: string;
    unit: string | null;
    pp: number | null;
    move: 'up' | 'down' | null;
    mates: number[];
    gp: number;
    gp_prev: number;
    cur: Record<string, number>;
    prev: Record<string, number>;
    log: LogRow[];
    game?: number;
    opp?: string;
    home?: number;
    toi?: number;
    fair?: Record<string, number>;
    /** pony xG expected count tonight, by category (the mean behind the fair prices). */
    proj?: Partial<Record<CategoryKey, number>>;
    book?: Record<string, BookPrice>;
}

export interface GoalieInfo {
    name: string;
    /** DailyFaceoff: Confirmed / Likely / Unconfirmed */
    status: string | null;
    /** pony xG goals saved above expected per game (regressed). */
    gsax: number | null;
}

export interface PropGame {
    id: number;
    start: string;
    state?: string;
    home: string;
    away: string;
    home_xg: number | null;
    away_xg: number | null;
    total: string | null;
    priced: boolean;
    goalies?: { home: GoalieInfo | null; away: GoalieInfo | null };
    /** Days since each side's last game (1 = played yesterday). */
    rest?: { home: number | null; away: number | null };
}

/** [date, missed, blocked, evToi, ppToi, ixG]: the same games as PropPlayer.log. */
export type ExtRow = [string, number | null, number | null, number | null, number | null, number | null];
/** [date, home, toi, g, a, sog, ppp, attempts]: a game against tonight's opponent. */
export type VsRow = [string, number, number | null, number, number, number, number, number | null];
/** Games played and hits per prop key. */
export type Split = { n: number } & Record<string, number>;

export interface PlayerDetail {
    x: ExtRow[];
    ha: { h: Split; a: Split };
    vs?: VsRow[];
    /** All archived games against tonight's opponent (vs holds the latest). */
    vs_n?: number;
}

/** public/data/props_detail.json: fetched when a row is first opened. */
export interface PropsDetailDoc {
    generated_at: string;
    slate_date: string;
    players: Record<string, PlayerDetail>;
}

export interface PropsDoc {
    generated_at: string;
    season: string;
    prev_season: string;
    slate_date: string;
    log_games: number;
    games: PropGame[];
    teams: Record<string, { sa: number; ga: number; sa_rank: number; ga_rank: number }>;
    players: PropPlayer[];
    book_source: string | null;
    book_fetched_at: string | null;
}

export type CategoryKey = 'sog' | 'g' | 'pts' | 'a' | 'ppp';

export interface Line {
    /** Prop key in props.json (fair / book / cur / prev). */
    key: string;
    /** Count needed to cash the over. */
    k: number;
    label: string;
}

export interface Category {
    key: CategoryKey;
    label: string;
    /** Column heading for the stat in a game log. */
    stat: string;
    lines: Line[];
    /** Count for one log row. */
    value: (r: LogRow) => number;
    /** Opponent rank that matters for this stat (shots or goals allowed). */
    oppRank: 'sa_rank' | 'ga_rank';
}

export const CATEGORIES: Category[] = [
    {
        key: 'sog',
        label: 'SOG',
        stat: 'SOG',
        lines: [
            { key: 'sog15', k: 2, label: 'o1.5' },
            { key: 'sog25', k: 3, label: 'o2.5' },
            { key: 'sog35', k: 4, label: 'o3.5' },
        ],
        value: r => r[6],
        oppRank: 'sa_rank',
    },
    { key: 'g', label: 'Goals', stat: 'G', lines: [{ key: 'atg', k: 1, label: 'Anytime' }], value: r => r[4], oppRank: 'ga_rank' },
    {
        key: 'pts',
        label: 'Points',
        stat: 'PTS',
        lines: [
            { key: 'p1', k: 1, label: 'o0.5' },
            { key: 'p2', k: 2, label: 'o1.5' },
        ],
        value: r => r[4] + r[5],
        oppRank: 'ga_rank',
    },
    { key: 'a', label: 'Assists', stat: 'A', lines: [{ key: 'a1', k: 1, label: 'o0.5' }], value: r => r[5], oppRank: 'ga_rank' },
    { key: 'ppp', label: 'PPP', stat: 'PPP', lines: [{ key: 'ppp1', k: 1, label: 'o0.5' }], value: r => r[7], oppRank: 'ga_rank' },
];

export const categoryOf = (key: CategoryKey): Category => CATEGORIES.find(c => c.key === key) ?? CATEGORIES[0];

/** 'book' = each skater's own posted line (SOG only; other categories have one line). */
export type LineChoice = 'book' | string;

/** The line a row is graded on: his posted line when `choice` is 'book' and he has one. */
export function lineFor(p: PropPlayer, cat: Category, choice: LineChoice): Line {
    if (choice !== 'book') return cat.lines.find(l => l.key === choice) ?? cat.lines[0];
    if (cat.lines.length === 1) return cat.lines[0];
    const posted = cat.lines.filter(l => p.book?.[l.key]?.over != null);
    if (!posted.length) return cat.lines[0];
    // Several posted lines (alternates): the one priced closest to even.
    return posted.reduce((best, l) => (Math.abs((p.book![l.key].imp ?? 0.5) - 0.5) < Math.abs((p.book![best.key].imp ?? 0.5) - 0.5) ? l : best));
}

export interface Rate {
    hits: number;
    n: number;
}

export const pct = (r: Rate | null | undefined): number | null => (r && r.n ? r.hits / r.n : null);

/** Hits over the last `n` logged games (fewer when the log is shorter). */
export function lastN(p: PropPlayer, cat: Category, line: Line, n: number): Rate {
    const rows = p.log.slice(-n);
    return { hits: rows.filter(r => cat.value(r) >= line.k).length, n: rows.length };
}

/** Consecutive games, newest first, that cleared the line. */
export function streak(p: PropPlayer, cat: Category, line: Line): number {
    let s = 0;
    for (let i = p.log.length - 1; i >= 0 && cat.value(p.log[i]) >= line.k; i--) s++;
    return s;
}

export const seasonRate = (p: PropPlayer, line: Line): Rate => ({ hits: p.cur[line.key] ?? 0, n: p.gp });
export const prevRate = (p: PropPlayer, line: Line): Rate => ({ hits: p.prev[line.key] ?? 0, n: p.gp_prev });

/** Fair minus book implied, in probability points (null without both). */
export function edge(p: PropPlayer, line: Line): number | null {
    const f = p.fair?.[line.key];
    const b = p.book?.[line.key]?.imp;
    return f != null && b != null ? f - b : null;
}

export function american(p: number | null | undefined): string {
    if (p == null) return '—';
    if (Math.abs(p) === 100) return 'EVEN';
    return p > 0 ? `+${p}` : String(p);
}

/** Fair American price for a probability. */
export function fairAmerican(prob: number | null | undefined): string {
    if (prob == null || prob <= 0 || prob >= 1) return '—';
    const v = prob >= 0.5 ? -Math.round((100 * prob) / (1 - prob)) : Math.round((100 * (1 - prob)) / prob);
    return american(v);
}

export const ELITE_IMP = 2 / 3; // -200 or shorter to record a point
export const PLUS_MONEY = 0.5;

export interface Boost {
    mate: PropPlayer;
    /** Linemate's 1+ point price (book when posted, else fair). */
    imp: number;
    fromBook: boolean;
    /** Shares the forward line (true) or only the PP unit (false). */
    line: boolean;
}

const pointImp = (p: PropPlayer): { imp: number; fromBook: boolean } | null => {
    const b = p.book?.p1?.imp;
    if (b != null) return { imp: b, fromBook: true };
    const f = p.fair?.p1;
    return f != null ? { imp: f, fromBook: false } : null;
};

/**
 * A plus-money point scorer skating with a linemate priced -200 or shorter to
 * record a point, on his forward line or his power-play unit. Returns the
 * strongest such linemate.
 */
export function boostFor(p: PropPlayer, byId: Map<number, PropPlayer>): Boost | null {
    const own = pointImp(p);
    if (!own || own.imp >= PLUS_MONEY || p.game == null) return null;
    const candidates: Boost[] = [];
    for (const id of p.mates) {
        const m = byId.get(id);
        const mi = m && pointImp(m);
        if (m && mi && mi.imp >= ELITE_IMP) candidates.push({ mate: m, ...mi, line: true });
    }
    if (p.pp) {
        for (const m of byId.values()) {
            if (m.id === p.id || m.team !== p.team || m.pp !== p.pp || p.mates.includes(m.id)) continue;
            const mi = pointImp(m);
            if (mi && mi.imp >= ELITE_IMP) candidates.push({ mate: m, ...mi, line: false });
        }
    }
    if (!candidates.length) return null;
    return candidates.sort((a, b) => Number(b.line) - Number(a.line) || b.imp - a.imp)[0];
}

export type View = 'tonight' | 'league';

export interface Filter {
    q: string;
    games: number[];
    pos: 'all' | 'F' | 'D';
    role: 'all' | 'top6' | 'pp1';
    priced: boolean;
    boost: boolean;
    hot: boolean;
}

export const DEFAULT_FILTER: Filter = { q: '', games: [], pos: 'all', role: 'all', priced: false, boost: false, hot: false };

const fold = (s: string) =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

export interface Row {
    p: PropPlayer;
    line: Line;
    l5: Rate;
    l10: Rate;
    l20: Rate;
    szn: Rate;
    prev: Rate;
    fair: number | null;
    imp: number | null;
    edge: number | null;
    streak: number;
    boost: Boost | null;
    oppRank: number | null;
    /** pony xG expected count tonight for the category. */
    proj: number | null;
    /** Shot attempts per game, last 10. */
    att: number | null;
    /** L5 hit rate clearly above his longer baseline (season, else last season). */
    hot: boolean;
}

export function buildRows(doc: PropsDoc, view: View, cat: Category, choice: LineChoice): Row[] {
    const byId = new Map(doc.players.map(p => [p.id, p]));
    const list = view === 'tonight' ? doc.players.filter(p => p.game != null) : doc.players;
    return list.map(p => {
        const line = view === 'league' && choice === 'book' ? cat.lines[0] : lineFor(p, cat, choice);
        const l5 = lastN(p, cat, line, 5);
        const szn = seasonRate(p, line);
        const prev = prevRate(p, line);
        const base = szn.n >= 10 ? pct(szn) : pct(prev);
        const l5p = pct(l5);
        return {
            p,
            line,
            l5,
            l10: lastN(p, cat, line, 10),
            l20: lastN(p, cat, line, 20),
            szn,
            prev,
            fair: p.fair?.[line.key] ?? null,
            imp: p.book?.[line.key]?.imp ?? null,
            edge: edge(p, line),
            streak: streak(p, cat, line),
            boost: cat.key === 'pts' || cat.key === 'a' ? boostFor(p, byId) : null,
            oppRank: p.opp ? (doc.teams[p.opp]?.[cat.oppRank] ?? null) : null,
            proj: p.proj?.[cat.key] ?? null,
            att: attemptsPer(p, 10).avg,
            hot: l5.n === 5 && l5p != null && base != null && l5p - base >= 0.25,
        };
    });
}

export function filterRows(rows: Row[], f: Filter): Row[] {
    const q = fold(f.q.trim());
    return rows.filter(({ p, imp, boost, hot }) => {
        if (q && !fold(p.name).includes(q) && !p.team.toLowerCase().includes(q)) return false;
        if (f.games.length && (p.game == null || !f.games.includes(p.game))) return false;
        if (f.pos === 'F' && p.pos === 'D') return false;
        if (f.pos === 'D' && p.pos !== 'D') return false;
        if (f.role === 'top6' && !['F1', 'F2', 'D1', 'D2'].includes(p.unit ?? '')) return false;
        if (f.role === 'pp1' && p.pp !== 1) return false;
        if (f.priced && imp == null) return false;
        if (f.boost && !boost) return false;
        if (f.hot && !hot) return false;
        return true;
    });
}

export type SortKey = 'name' | 'opp' | 'toi' | 'proj' | 'att' | 'l5' | 'l10' | 'l20' | 'szn' | 'imp' | 'fair' | 'edge' | 'streak';

export const FIRST_DIR: Partial<Record<SortKey, 'asc' | 'desc'>> = { name: 'asc', opp: 'asc' };

function sortValue(r: Row, key: SortKey): number | string | null {
    switch (key) {
        case 'name':
            return r.p.name;
        case 'opp':
            return r.oppRank;
        case 'toi':
            return r.p.toi ?? null;
        case 'proj':
            return r.proj;
        case 'att':
            return r.att;
        case 'l5':
            return pct(r.l5);
        case 'l10':
            return pct(r.l10);
        case 'l20':
            return pct(r.l20);
        case 'szn':
            return pct(r.szn);
        case 'imp':
            return r.imp;
        case 'fair':
            return r.fair;
        case 'edge':
            return r.edge;
        case 'streak':
            return r.streak;
    }
}

/** Sorted copy; missing values always last, ties broken by fair % then name. */
export function sortRows(rows: Row[], key: SortKey, dir: 'asc' | 'desc'): Row[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const va = sortValue(a, key);
        const vb = sortValue(b, key);
        if (va == null && vb != null) return 1;
        if (vb == null && va != null) return -1;
        if (va != null && vb != null && va !== vb) {
            return typeof va === 'string' ? sign * va.localeCompare(String(vb)) : sign * ((va as number) - (vb as number));
        }
        return (b.fair ?? -1) - (a.fair ?? -1) || a.p.name.localeCompare(b.p.name);
    });
}

/** Default sort for a view: edge when the slate is priced, else last-10 hit rate. */
export const defaultSort = (rows: Row[]): SortKey => (rows.some(r => r.edge != null) ? 'edge' : 'l10');

/** "2026-10-03" → "Oct 3". */
export function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "C. McDavid" for narrow screens. */
export function shortName(name: string): string {
    const parts = name.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

export const mean = (xs: (number | null | undefined)[]): number | null => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Season start year of a game date (seasons roll over on July 1). */
export const seasonStart = (iso: string): number => {
    const [y, m] = iso.split('-').map(Number);
    return m >= 7 ? y : y - 1;
};

/** "2025-11-03" → "25-26" */
export const seasonLabel = (iso: string): string => {
    const y = seasonStart(iso);
    return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
};

/** Shot attempts per game over the last `n` logged games that carry attempts. */
export function attemptsPer(p: PropPlayer, n: number): { avg: number | null; onNet: number | null; n: number } {
    const rows = p.log.slice(-n).filter(r => r[9] != null);
    const att = rows.reduce((a, r) => a + (r[9] ?? 0), 0);
    const sog = rows.reduce((a, r) => a + r[6], 0);
    return { avg: rows.length ? att / rows.length : null, onNet: att ? sog / att : null, n: rows.length };
}

/** The detail rows for a player's log, matched by date (null where the detail file has none). */
export function extFor(p: PropPlayer, d: PlayerDetail | null | undefined): (ExtRow | null)[] {
    const byDate = new Map((d?.x ?? []).map(x => [x[0], x]));
    return p.log.map(r => byDate.get(r[0]) ?? null);
}

/** Games against tonight's opponent as log rows, so tapes and hit counts reuse the category logic. */
export function vsLog(p: PropPlayer, d: PlayerDetail | null | undefined, currentStart: number): LogRow[] {
    return (d?.vs ?? []).map(v => [v[0], p.opp ?? '', v[1], v[2] ?? 0, v[3], v[4], v[5], v[6], seasonStart(v[0]) < currentStart ? 1 : 0, v[7]]);
}

/** Hits and the mean count over a set of log rows. */
export function summarize(rows: LogRow[], cat: Category, line: Line): { hits: number; n: number; avg: number | null } {
    return { hits: rows.filter(r => cat.value(r) >= line.k).length, n: rows.length, avg: mean(rows.map(r => cat.value(r))) };
}
