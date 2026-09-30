/**
 * Pure standings / projections logic for /standings (no fs, no React), so it
 * runs on the server, the client and in vitest.
 */

import { compareOfficial } from '@/utils/team-stats/official-order';

export type Conference = 'East' | 'West';
export type Division = 'Atlantic' | 'Metropolitan' | 'Central' | 'Pacific';

export const DIVISION_OF: Record<string, Division> = {
    BOS: 'Atlantic', BUF: 'Atlantic', DET: 'Atlantic', FLA: 'Atlantic', MTL: 'Atlantic', OTT: 'Atlantic', TBL: 'Atlantic', TOR: 'Atlantic',
    CAR: 'Metropolitan', CBJ: 'Metropolitan', NJD: 'Metropolitan', NYI: 'Metropolitan', NYR: 'Metropolitan', PHI: 'Metropolitan', PIT: 'Metropolitan', WSH: 'Metropolitan',
    CHI: 'Central', COL: 'Central', DAL: 'Central', MIN: 'Central', NSH: 'Central', STL: 'Central', UTA: 'Central', WPG: 'Central',
    ANA: 'Pacific', CGY: 'Pacific', EDM: 'Pacific', LAK: 'Pacific', SEA: 'Pacific', SJS: 'Pacific', VAN: 'Pacific', VGK: 'Pacific',
};

export const CONFERENCE_OF_DIVISION: Record<Division, Conference> = {
    Atlantic: 'East',
    Metropolitan: 'East',
    Central: 'West',
    Pacific: 'West',
};

export const DIVISIONS_BY_CONF: Record<Conference, [Division, Division]> = {
    East: ['Atlantic', 'Metropolitan'],
    West: ['Central', 'Pacific'],
};

/** GP threshold before "If the playoffs started today" is meaningful. */
export const STANDINGS_BRACKET_MIN_GP = 20;

export interface TeamProjection {
    avgPoints: number;
    /** 10th / 90th percentile of simulated points (80% band). */
    p10: number;
    p90: number;
    playoffPct: number;
    divisionPct: number;
    conferencePct?: number;
    cupPct: number;
    /** Opponent tricode → share of sims (0–1) with that first-round matchup. */
    r1: Record<string, number>;
}

export interface StandingsRow {
    tri: string;
    name: string;
    short: string;
    conference: Conference;
    division: Division;
    gp: number;
    w: number;
    l: number;
    otl: number;
    pts: number;
    rw: number;
    row: number;
    /** Goal differential (standings convention). */
    gd?: number;
    /** Goals for (standings convention). */
    gf?: number;
    proj: TeamProjection | null;
    /** Playoff % change vs the previous daily snapshot (points), or null. */
    delta24: number | null;
    /** Up to 30 daily playoff % values, oldest → newest. */
    trend: number[];
}

/* ── Projections file ─────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Percentile (0–1) of a {points: count} histogram. */
export function distPercentile(dist: Record<string, number>, q: number): number | undefined {
    const pts = Object.entries(dist)
        .map(([k, c]) => [Number(k), Number(c)] as const)
        .filter(([k, c]) => Number.isFinite(k) && Number.isFinite(c) && c > 0)
        .sort((a, b) => a[0] - b[0]);
    const total = pts.reduce((s, [, c]) => s + c, 0);
    if (!total) return undefined;
    const target = q * total;
    let cum = 0;
    for (const [k, c] of pts) {
        cum += c;
        if (cum >= target) return k;
    }
    return pts[pts.length - 1][0];
}

export interface ProjectionsFile {
    seasonId: string | null;
    generatedAt: string | null;
    totalSims: number;
    byTeam: Record<string, TeamProjection>;
}

export function parseProjections(raw: unknown): ProjectionsFile {
    const out: ProjectionsFile = { seasonId: null, generatedAt: null, totalSims: 0, byTeam: {} };
    if (!isObj(raw)) return out;
    const sid = raw.season_id ?? raw.seasonId;
    out.seasonId = sid != null && String(sid).trim() !== '' ? String(sid) : null;
    out.generatedAt = typeof raw.generated_at === 'string' ? raw.generated_at : null;
    out.totalSims = n(raw.total_simulations) ?? 0;
    const teams = Array.isArray(raw.teams) ? raw.teams : [];
    for (const t of teams) {
        if (!isObj(t) || typeof t.team !== 'string') continue;
        const dist = isObj(t.point_dist) ? (t.point_dist as Record<string, number>) : {};
        const avg = n(t.avg_points) ?? 0;
        const r1raw = isObj(t.r1_matchups) ? t.r1_matchups : {};
        const r1Total = out.totalSims || Object.values(r1raw).reduce<number>((s, c) => s + (n(c) ?? 0), 0) || 1;
        const r1: Record<string, number> = {};
        for (const [opp, c] of Object.entries(r1raw)) {
            const v = n(c);
            if (v) r1[opp] = v / r1Total;
        }
        out.byTeam[t.team] = {
            avgPoints: avg,
            p10: distPercentile(dist, 0.1) ?? avg,
            p90: distPercentile(dist, 0.9) ?? avg,
            playoffPct: n(t.make_playoffs_pct) ?? 0,
            divisionPct: n(t.won_division_pct) ?? 0,
            conferencePct: n(t.won_conference_pct),
            cupPct: n(t.won_cup_pct) ?? 0,
            r1,
        };
    }
    return out;
}

/* ── Projection history (daily snapshots) ─────────────────────────────── */

export interface HistoryPoint {
    date: string;
    pct: number;
}

/**
 * Tolerant reader for season_projections_history.json. Accepts:
 *   { season_id?, snapshots: [{ date | generated_at, season_id?, teams: {TRI: {make_playoffs_pct}} | [{team, make_playoffs_pct}] }] }
 *   [ ...same snapshots... ]
 *   { teams: { TRI: [{ date, make_playoffs_pct | playoff_pct | pct }] } }  or  { TRI: [...] }
 * Snapshots from another season are dropped; one point per team per day (the last one).
 */
export function parseProjectionHistory(raw: unknown, seasonId: string): Record<string, HistoryPoint[]> {
    const out: Record<string, HistoryPoint[]> = {};
    const push = (tri: string, date: unknown, pct: unknown) => {
        const d = typeof date === 'string' ? date.slice(0, 10) : '';
        const p = n(pct);
        if (!/^[A-Z]{3}$/.test(tri) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || p == null) return;
        const list = (out[tri] ??= []);
        const same = list.findIndex(x => x.date === d);
        if (same >= 0) list[same] = { date: d, pct: p };
        else list.push({ date: d, pct: p });
    };
    const pctOf = (o: Obj) => o.make_playoffs_pct ?? o.playoff_pct ?? o.playoffPct ?? o.pct;
    const seasonOk = (s: unknown) => s == null || String(s) === seasonId;

    const snapshots: unknown[] | null = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.snapshots) ? raw.snapshots : null;
    if (snapshots) {
        if (isObj(raw) && !seasonOk(raw.season_id)) return out;
        for (const s of snapshots) {
            if (!isObj(s) || !seasonOk(s.season_id)) continue;
            const date = s.date ?? s.generated_at;
            if (Array.isArray(s.teams)) {
                for (const t of s.teams) if (isObj(t) && typeof t.team === 'string') push(t.team, date, pctOf(t));
            } else if (isObj(s.teams)) {
                for (const [tri, v] of Object.entries(s.teams)) push(tri, date, isObj(v) ? pctOf(v) : v);
            }
        }
    } else if (isObj(raw)) {
        if (!seasonOk(raw.season_id)) return out;
        const byTeam = isObj(raw.teams) ? raw.teams : raw;
        for (const [tri, list] of Object.entries(byTeam)) {
            if (!Array.isArray(list)) continue;
            for (const p of list) if (isObj(p)) push(tri, p.date ?? p.generated_at, pctOf(p));
        }
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

/** Change vs the previous day's snapshot, and the last 30 days of values. */
export function trendFor(history: HistoryPoint[] | undefined, current: number | undefined): { delta24: number | null; trend: number[] } {
    const pts = [...(history ?? [])];
    if (current != null && pts.length) {
        // The live file is newer than (or the same as) the last snapshot.
        pts[pts.length - 1] = { ...pts[pts.length - 1], pct: current };
    }
    const trend = pts.slice(-30).map(p => p.pct);
    const delta24 = pts.length >= 2 ? pts[pts.length - 1].pct - pts[pts.length - 2].pct : null;
    return { delta24, trend };
}

/* ── Standings order and seeding ──────────────────────────────────────── */

/**
 * Official NHL order (shared with /teams via compareOfficial): points, P%,
 * fewer GP, RW, ROW, W, goal differential, goals for. Only when all of those
 * tie do the model's projected points break the tie.
 */
export function compareStandings(a: StandingsRow, b: StandingsRow): number {
    return (
        compareOfficial(
            { pts: a.pts, gp: a.gp, rw: a.rw, row: a.row, w: a.w, gd: a.gd ?? 0, gf: a.gf ?? 0 },
            { pts: b.pts, gp: b.gp, rw: b.rw, row: b.row, w: b.w, gd: b.gd ?? 0, gf: b.gf ?? 0 },
        ) ||
        (b.proj?.avgPoints ?? 0) - (a.proj?.avgPoints ?? 0) ||
        a.tri.localeCompare(b.tri)
    );
}

/** Order by the model's projected finish (for the projected bracket). */
export function compareProjected(a: StandingsRow, b: StandingsRow): number {
    return (b.proj?.avgPoints ?? 0) - (a.proj?.avgPoints ?? 0) || (b.proj?.playoffPct ?? 0) - (a.proj?.playoffPct ?? 0) || a.tri.localeCompare(b.tri);
}

export interface Seed {
    tri: string;
    /** "C1", "P2", "WC1" … */
    label: string;
    /** 1 = best in the conference. */
    rank: number;
}

export interface ConferenceSeeding {
    conference: Conference;
    divisions: [Division, Division];
    /** Four first-round pairs in bracket order: [top-half ×2, bottom-half ×2]. */
    r1: [Seed, Seed][];
    /** Teams inside the cut line, by division (3 each) plus the wild cards. */
    wildCards: StandingsRow[];
}

const DIV_ABBR: Record<Division, string> = { Atlantic: 'A', Metropolitan: 'M', Central: 'C', Pacific: 'P' };

/**
 * NHL playoff format: top 3 of each division plus 2 wild cards per conference.
 * The division winner with more points plays WC2; the other plays WC1; 2 vs 3
 * inside each division.
 */
export function seedConference(rows: StandingsRow[], conference: Conference, cmp = compareStandings): ConferenceSeeding | null {
    const [d1, d2] = DIVISIONS_BY_CONF[conference];
    const inConf = rows.filter(r => r.conference === conference);
    const div1 = inConf.filter(r => r.division === d1).sort(cmp);
    const div2 = inConf.filter(r => r.division === d2).sort(cmp);
    if (div1.length < 3 || div2.length < 3) return null;
    const rest = [...div1.slice(3), ...div2.slice(3)].sort(cmp);
    if (rest.length < 2) return null;
    const [wc1, wc2] = rest;
    // The better division winner hosts WC2.
    const firstIsTop = cmp(div1[0], div2[0]) <= 0;
    const [topDiv, topRows, otherDiv, otherRows] = firstIsTop ? [d1, div1, d2, div2] as const : [d2, div2, d1, div1] as const;
    const s = (r: StandingsRow, label: string, rank: number): Seed => ({ tri: r.tri, label, rank });
    const ta = DIV_ABBR[topDiv];
    const oa = DIV_ABBR[otherDiv];
    const r1: [Seed, Seed][] = [
        [s(topRows[0], `${ta}1`, 1), s(wc2, 'WC2', 8)],
        [s(topRows[1], `${ta}2`, 3), s(topRows[2], `${ta}3`, 6)],
        [s(otherRows[0], `${oa}1`, 2), s(wc1, 'WC1', 7)],
        [s(otherRows[1], `${oa}2`, 4), s(otherRows[2], `${oa}3`, 5)],
    ];
    return { conference, divisions: [topDiv, otherDiv], r1, wildCards: rest };
}

/* ── First-round matchup odds ─────────────────────────────────────────── */

export interface MatchupOdds {
    a: string;
    b: string;
    /** Share of simulations (0–1) in which this exact series happened. */
    p: number;
}

/** Most likely first-round series per conference from r1_matchups. */
export function likelyMatchups(rows: StandingsRow[], conference: Conference, limit = 6): MatchupOdds[] {
    const seen = new Map<string, MatchupOdds>();
    for (const r of rows) {
        if (r.conference !== conference || !r.proj) continue;
        for (const [opp, p] of Object.entries(r.proj.r1)) {
            const key = [r.tri, opp].sort().join('-');
            const prev = seen.get(key);
            // Each pair appears from both sides; keep the larger (they should match).
            if (!prev || p > prev.p) {
                const [a, b] = (r.proj.avgPoints >= (rows.find(x => x.tri === opp)?.proj?.avgPoints ?? 0) ? [r.tri, opp] : [opp, r.tri]);
                seen.set(key, { a, b, p });
            }
        }
    }
    return [...seen.values()].sort((x, y) => y.p - x.p).slice(0, limit);
}

/* ── Series odds (Poisson goal model on team ratings) ─────────────────── */

export interface TeamStrength {
    xgf5: number;
    xga5: number;
    /** PP% as a fraction of league average (1 = average). */
    ppEff: number;
    /** League-average PK% ÷ team PK% (below 1 = better PK). */
    pkEff: number;
    drawn60: number;
    taken60: number;
}

export const AVERAGE_STRENGTH: TeamStrength = { xgf5: 2.35, xga5: 2.35, ppEff: 1, pkEff: 1, drawn60: 3, taken60: 3 };

function factorial(k: number): number {
    let r = 1;
    for (let i = 2; i <= k; i++) r *= i;
    return r;
}
const poisson = (k: number, lambda: number) => (lambda ** k * Math.exp(-lambda)) / factorial(k);

/** Single-game win probability for `home` (ties split by scoring rate). */
export function gameWinProb(home: TeamStrength, away: TeamStrength): number {
    const AVG = 2.35;
    const HOME_ICE = 0.16;
    const ST = 0.18;
    const h5 = (home.xgf5 * away.xga5) / AVG;
    const a5 = (away.xgf5 * home.xga5) / AVG;
    const hOpp = (home.drawn60 + away.taken60) / 2;
    const aOpp = (away.drawn60 + home.taken60) / 2;
    const hx = Math.max(0.1, h5 + HOME_ICE + hOpp * ST * home.ppEff * away.pkEff);
    const ax = Math.max(0.1, a5 + aOpp * ST * away.ppEff * home.pkEff);
    let w = 0;
    let l = 0;
    let t = 0;
    for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
            const p = poisson(i, hx) * poisson(j, ax);
            if (i > j) w += p;
            else if (j > i) l += p;
            else t += p;
        }
    }
    const tot = w + l + t;
    return w / tot + (t / tot) * (hx / (hx + ax));
}

/** Best-of-7 win probability for a team with per-game win probability p. */
export function seriesWinProb(p: number): number {
    let total = 0;
    for (let g = 4; g <= 7; g++) {
        const ways = factorial(g - 1) / (factorial(3) * factorial(g - 4));
        total += ways * p ** 4 * (1 - p) ** (g - 4);
    }
    return total;
}

/**
 * Series odds for the higher seed (who has home ice). Averages the home and
 * road game probabilities in a 2-2-1-1-1 split (4 home, 3 road).
 */
export function seriesOdds(higher: TeamStrength, lower: TeamStrength): number {
    const home = gameWinProb(higher, lower);
    const road = 1 - gameWinProb(lower, higher);
    return seriesWinProb((4 * home + 3 * road) / 7);
}

/** team_ratings.json entry (keyed by common name) → strength. */
export function strengthFromRatings(r: Obj | undefined): TeamStrength {
    if (!r) return AVERAGE_STRENGTH;
    const pp = n(r.pp_rating) ?? 20;
    const pk = n(r.pk_rating) ?? 80;
    return {
        xgf5: n(r.xgf_5v5_rating) ?? 2.35,
        xga5: n(r.xga_5v5_rating) ?? 2.35,
        ppEff: pp / 20,
        pkEff: 0.8 / Math.max(0.5, pk / 100),
        drawn60: n(r.penalties_drawn_per_60) ?? 3,
        taken60: n(r.penalties_taken_per_60) ?? 3,
    };
}
