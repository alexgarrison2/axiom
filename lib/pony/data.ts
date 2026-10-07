import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { GS_PARTS, type GsPart } from '@/lib/game/analytics';
import { conferenceOf, divisionOf } from './teams';

/**
 * The Pony Score season files (public/data/pony/<season>.json, written by
 * scripts/pony_scores.ts) as typed rows, plus the leaderboard filters and
 * aggregation. Server only: the files are a few MB, the pages get the result.
 */

export type Result = 'W' | 'L' | 'OTL';

export interface PonyPlayer {
    id: number;
    first: string;
    last: string;
    pos: string;
    num: number | null;
    headshot: string | null;
    team: string;
}

export interface PonyGame {
    id: number;
    date: string;
    away: string;
    home: string;
    awayScore: number;
    homeScore: number;
    outcome: string;
}

interface Common {
    game: number;
    date: string;
    player: number;
    team: string;
    opp: string;
    home: boolean;
    result: Result;
    /** Days since the team's previous game, less one (0 = back-to-back); null for its first game. */
    rest: number | null;
    toi: number;
    ps: number;
}
export interface SkaterGame extends Common {
    pos: 'F' | 'D';
    parts: Record<GsPart, number>;
    g: number;
    a1: number;
    a2: number;
    sog: number;
    ixg: number;
    hit: number;
    blk: number;
    pim: number;
    pm: number;
    toiPp: number;
    toiPk: number;
}
export interface GoalieGame extends Common {
    sa: number;
    ga: number;
    xga: number;
}

export interface PonySeason {
    season: string;
    builtAt: string;
    games: Map<number, PonyGame>;
    players: Map<number, PonyPlayer>;
    skaters: SkaterGame[];
    goalies: GoalieGame[];
}

const DIR = () => path.join(process.cwd(), 'public', 'data', 'pony');
const cache = new Map<string, { mtime: number; data: PonySeason }>();

/** Seasons with a Pony Score file, newest first. */
export function ponySeasons(): string[] {
    try {
        return fs
            .readdirSync(DIR())
            .filter(f => /^\d{8}\.json$/.test(f))
            .map(f => f.slice(0, 8))
            .sort()
            .reverse();
    } catch {
        return [];
    }
}

export function loadPonySeason(season: string): PonySeason | null {
    if (!/^\d{8}$/.test(season)) return null;
    const file = path.join(DIR(), `${season}.json`);
    let mtime = 0;
    try {
        mtime = fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
    const hit = cache.get(season);
    if (hit && hit.mtime === mtime) return hit.data;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        season: string;
        built_at: string;
        games: Record<string, [string, string, string, number, number, string]>;
        players: Record<string, [string, string, string, number | null, string | null, string]>;
        skater_cols: string[];
        skaters: (string | number)[][];
        goalie_cols: string[];
        goalies: (string | number)[][];
    };
    const games = new Map<number, PonyGame>();
    for (const [id, [date, away, home, as, hs, outcome]] of Object.entries(doc.games)) {
        games.set(Number(id), { id: Number(id), date, away, home, awayScore: as, homeScore: hs, outcome });
    }
    const players = new Map<number, PonyPlayer>();
    for (const [id, [first, last, pos, num, headshot, team]] of Object.entries(doc.players)) {
        players.set(Number(id), { id: Number(id), first, last, pos, num, headshot, team });
    }

    // Rest: days between a team's games, less one.
    const teamDates = new Map<string, string[]>();
    for (const g of games.values()) for (const t of [g.away, g.home]) teamDates.set(t, [...(teamDates.get(t) ?? []), g.date]);
    const restOf = new Map<string, number | null>();
    for (const [t, ds] of teamDates) {
        const sorted = [...new Set(ds)].sort();
        sorted.forEach((d, i) => {
            restOf.set(`${t}|${d}`, i === 0 ? null : Math.round((Date.parse(d) - Date.parse(sorted[i - 1])) / 86_400_000) - 1);
        });
    }
    const resultOf = (g: PonyGame, team: string): Result => {
        const home = g.home === team;
        const mine = home ? g.homeScore : g.awayScore;
        const theirs = home ? g.awayScore : g.homeScore;
        return mine > theirs ? 'W' : g.outcome !== 'REG' ? 'OTL' : 'L';
    };

    const sc = Object.fromEntries(doc.skater_cols.map((c, i) => [c, i]));
    const skaters: SkaterGame[] = [];
    for (const r of doc.skaters) {
        const g = games.get(Number(r[sc.game]));
        if (!g) continue;
        const team = String(r[sc.team]);
        skaters.push({
            game: g.id,
            date: g.date,
            player: Number(r[sc.player]),
            team,
            opp: String(r[sc.opp]),
            home: r[sc.home] === 1,
            result: resultOf(g, team),
            rest: restOf.get(`${team}|${g.date}`) ?? null,
            pos: r[sc.pos] === 'D' ? 'D' : 'F',
            toi: Number(r[sc.toi]),
            ps: Number(r[sc.ps]),
            parts: Object.fromEntries(GS_PARTS.map(k => [k, Number(r[sc[k]])])) as Record<GsPart, number>,
            g: Number(r[sc.g]),
            a1: Number(r[sc.a1]),
            a2: Number(r[sc.a2]),
            sog: Number(r[sc.sog]),
            ixg: Number(r[sc.ixg]),
            hit: Number(r[sc.hit]),
            blk: Number(r[sc.blk]),
            pim: Number(r[sc.pim]),
            pm: Number(r[sc.pm]),
            toiPp: Number(r[sc.toi_pp]),
            toiPk: Number(r[sc.toi_pk]),
        });
    }
    const gc = Object.fromEntries(doc.goalie_cols.map((c, i) => [c, i]));
    const goalies: GoalieGame[] = [];
    for (const r of doc.goalies) {
        const g = games.get(Number(r[gc.game]));
        if (!g) continue;
        const team = String(r[gc.team]);
        goalies.push({
            game: g.id,
            date: g.date,
            player: Number(r[gc.player]),
            team,
            opp: String(r[gc.opp]),
            home: r[gc.home] === 1,
            result: resultOf(g, team),
            rest: restOf.get(`${team}|${g.date}`) ?? null,
            toi: Number(r[gc.toi]),
            ps: Number(r[gc.ps]),
            sa: Number(r[gc.sa]),
            ga: Number(r[gc.ga]),
            xga: Number(r[gc.xga]),
        });
    }
    const data: PonySeason = { season: doc.season, builtAt: doc.built_at, games, players, skaters, goalies };
    cache.set(season, { mtime, data });
    return data;
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

export type PosFilter = 'all' | 'F' | 'D' | 'G';
export type SortKey = 'avg' | 'total' | 'per60' | 'off' | 'def';

export interface PonyFilters {
    season: string;
    pos: PosFilter;
    from: string | null;
    to: string | null;
    last: number | null;
    venue: 'all' | 'home' | 'road';
    rest: 'all' | 'b2b' | '1' | '2+';
    result: 'all' | 'W' | 'L';
    vs: string | null;
    team: string | null;
    minGp: number;
    sort: SortKey;
    dir: 'top' | 'bottom';
}

export const DEFAULT_FILTERS: Omit<PonyFilters, 'season'> = {
    pos: 'all',
    from: null,
    to: null,
    last: null,
    venue: 'all',
    rest: 'all',
    result: 'all',
    vs: null,
    team: null,
    minGp: 0,
    sort: 'avg',
    dir: 'top',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL search params -> filters (unknown values fall back to the defaults). */
export function parseFilters(sp: Record<string, string | string[] | undefined>, seasons: string[]): PonyFilters {
    const g = (k: string) => one(sp[k]);
    const pick = <T extends string>(v: string | undefined, ok: readonly T[], d: T): T => (v && (ok as readonly string[]).includes(v) ? (v as T) : d);
    const season = g('season') && seasons.includes(g('season')!) ? g('season')! : (seasons[0] ?? '');
    const last = Number(g('last'));
    const minGp = Number(g('gp'));
    const vs = g('vs');
    const team = g('team');
    return {
        season,
        pos: pick(g('pos'), ['all', 'F', 'D', 'G'] as const, 'all'),
        from: g('from') && DATE.test(g('from')!) ? g('from')! : null,
        to: g('to') && DATE.test(g('to')!) ? g('to')! : null,
        last: Number.isInteger(last) && last > 0 && last <= 200 ? last : null,
        venue: pick(g('venue'), ['all', 'home', 'road'] as const, 'all'),
        rest: pick(g('rest'), ['all', 'b2b', '1', '2+'] as const, 'all'),
        result: pick(g('result'), ['all', 'W', 'L'] as const, 'all'),
        vs: vs && /^([A-Z]{3}|div:[A-Za-z]+|conf:(East|West))$/.test(vs) ? vs : null,
        team: team && /^[A-Z]{3}$/.test(team) ? team : null,
        minGp: Number.isInteger(minGp) && minGp > 0 && minGp <= 200 ? minGp : 0,
        sort: pick(g('sort'), ['avg', 'total', 'per60', 'off', 'def'] as const, 'avg'),
        dir: pick(g('dir'), ['top', 'bottom'] as const, 'top'),
    };
}

function keep<T extends Common>(r: T, f: PonyFilters): boolean {
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (f.venue === 'home' && !r.home) return false;
    if (f.venue === 'road' && r.home) return false;
    if (f.result === 'W' && r.result !== 'W') return false;
    if (f.result === 'L' && r.result === 'W') return false;
    if (f.rest === 'b2b' && r.rest !== 0) return false;
    if (f.rest === '1' && r.rest !== 1) return false;
    if (f.rest === '2+' && (r.rest == null || r.rest < 2)) return false;
    if (f.team && r.team !== f.team) return false;
    if (f.vs) {
        if (f.vs.startsWith('div:') && divisionOf(r.opp) !== f.vs.slice(4)) return false;
        if (f.vs.startsWith('conf:') && conferenceOf(r.opp) !== f.vs.slice(5)) return false;
        if (/^[A-Z]{3}$/.test(f.vs) && r.opp !== f.vs) return false;
    }
    return true;
}

export interface LeaderRow {
    player: PonyPlayer;
    team: string;
    pos: string;
    gp: number;
    toi: number;
    total: number;
    avg: number;
    per60: number;
    off: number;
    def: number;
    /** Average of each part per game (skaters). */
    parts: Record<GsPart, number> | null;
    /** Goalies: shots against, goals against, xG against. */
    goalie: { sa: number; ga: number; xga: number } | null;
    /** Last ten scores, oldest first. */
    form: number[];
    best: { ps: number; game: number; date: string; opp: string } | null;
}

/** Rows that pass the filters, per player, after `last` (each player's most recent N). */
function grouped<T extends Common>(rows: T[], f: PonyFilters): Map<number, T[]> {
    const by = new Map<number, T[]>();
    for (const r of rows) if (keep(r, f)) by.set(r.player, [...(by.get(r.player) ?? []), r]);
    if (f.last) for (const [k, v] of by) by.set(k, [...v].sort((a, b) => a.date.localeCompare(b.date)).slice(-f.last));
    return by;
}

export function leaderboard(data: PonySeason, f: PonyFilters): LeaderRow[] {
    const out: LeaderRow[] = [];
    const add = (id: number, rows: Common[], extra: (rows: Common[]) => Pick<LeaderRow, 'off' | 'def' | 'parts' | 'goalie'>) => {
        const p = data.players.get(id);
        if (!p || rows.length < Math.max(1, f.minGp)) return;
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const total = rows.reduce((a, r) => a + r.ps, 0);
        const toi = rows.reduce((a, r) => a + r.toi, 0);
        const best = rows.reduce((b, r) => (r.ps > b.ps ? r : b), rows[0]);
        out.push({
            player: p,
            team: sorted[sorted.length - 1].team,
            pos: p.pos,
            gp: rows.length,
            toi: toi / rows.length,
            total,
            avg: total / rows.length,
            per60: toi > 0 ? (total / toi) * 3600 : 0,
            form: sorted.slice(-10).map(r => r.ps),
            best: { ps: best.ps, game: best.game, date: best.date, opp: best.opp },
            ...extra(rows),
        });
    };
    if (f.pos !== 'G') {
        for (const [id, rows] of grouped(data.skaters.filter(r => f.pos === 'all' || r.pos === f.pos), f)) {
            add(id, rows, rs => {
                const s = rs as SkaterGame[];
                const parts = Object.fromEntries(GS_PARTS.map(k => [k, s.reduce((a, r) => a + r.parts[k], 0) / s.length])) as Record<GsPart, number>;
                return {
                    parts,
                    off: parts.oProd + parts.oDrive + parts.oSpecial + parts.oUsage,
                    def: parts.dProd + parts.dDrive + parts.dSpecial + parts.dUsage,
                    goalie: null,
                };
            });
        }
    }
    if (f.pos === 'G') {
        for (const [id, rows] of grouped(data.goalies, f)) {
            add(id, rows, rs => {
                const g = rs as GoalieGame[];
                const sum = (k: 'sa' | 'ga' | 'xga') => g.reduce((a, r) => a + r[k], 0);
                return { parts: null, off: 0, def: g.reduce((a, r) => a + r.ps, 0) / g.length, goalie: { sa: sum('sa'), ga: sum('ga'), xga: sum('xga') } };
            });
        }
    }
    const key = (r: LeaderRow) => (f.sort === 'total' ? r.total : f.sort === 'per60' ? r.per60 : f.sort === 'off' ? r.off : f.sort === 'def' ? r.def : r.avg);
    out.sort((a, b) => (f.dir === 'top' ? key(b) - key(a) : key(a) - key(b)) || b.gp - a.gp);
    return out;
}

/** One player's games in a season, oldest first. */
export function playerGames(data: PonySeason, id: number): { skater: SkaterGame[]; goalie: GoalieGame[] } {
    return {
        skater: data.skaters.filter(r => r.player === id).sort((a, b) => a.date.localeCompare(b.date)),
        goalie: data.goalies.filter(r => r.player === id).sort((a, b) => a.date.localeCompare(b.date)),
    };
}
