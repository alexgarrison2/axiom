/**
 * Everything the game page derives from a GameModel. Pure functions, shared
 * by the server page and the client sections (filters recompute in the
 * browser).
 */
import { effectiveSkaters } from './build';
import { other, SIDES, type GameEvent, type GameModel, type Player, type Pos, type Shift, type Side } from './types';

/* ── Score adjustment ─────────────────────────────────────────────────────
 * 5v5 regular-season share of unblocked attempts and of xG by the shooting
 * team's score state, 2022-23 to 2025-26 (pipeline/nhl_historical_shots.csv).
 * A shot is weighted 0.5 / share(state): a trailing team's attempts count a
 * little less, its xG a little more (leading teams give up fewer, better looks).
 */
const ATTEMPT_SHARE: Record<number, number> = { [-3]: 0.5461, [-2]: 0.5388, [-1]: 0.5266, 0: 0.5, 1: 0.4734, 2: 0.4612, 3: 0.4539 };
const XG_SHARE: Record<number, number> = { [-3]: 0.4608, [-2]: 0.4411, [-1]: 0.4763, 0: 0.5, 1: 0.5237, 2: 0.5589, 3: 0.5392 };

export const scoreState = (e: GameEvent): number => {
    const d = e.side === 'home' ? e.score.home - e.score.away : e.score.away - e.score.home;
    return Math.max(-3, Math.min(3, d));
};
export const attemptWeight = (e: GameEvent) => 0.5 / ATTEMPT_SHARE[scoreState(e)];
export const xgWeight = (e: GameEvent) => 0.5 / XG_SHARE[scoreState(e)];

/* ── Filters ──────────────────────────────────────────────────────────── */

/** Team-level strength filter: all, 5v5, even strength, or one side's power play. */
export type TeamStrength = 'all' | '5v5' | 'ev' | 'awayPP' | 'homePP';
/** Player-level strength filter, from the player's side. */
export type PlayerStrength = 'all' | '5v5' | 'ev' | 'pp' | 'sh';
export type PeriodFilter = 'all' | number;

export const isAttempt = (e: GameEvent) => e.type === 'goal' || e.type === 'shot' || e.type === 'miss' || e.type === 'block';
export const isUnblocked = (e: GameEvent) => e.type === 'goal' || e.type === 'shot' || e.type === 'miss';
export const isOnGoal = (e: GameEvent) => e.type === 'goal' || e.type === 'shot';
/** High-danger chance: an unblocked attempt worth 0.15 xG or more. */
export const HD_XG = 0.15;

export function matchTeamStrength(e: GameEvent, f: TeamStrength): boolean {
    const s = e.situation;
    switch (f) {
        case 'all':
            return true;
        case '5v5':
            return e.fiveOnFive;
        case 'ev':
            return effectiveSkaters('away', s) === effectiveSkaters('home', s);
        case 'awayPP':
            return effectiveSkaters('away', s) > effectiveSkaters('home', s);
        case 'homePP':
            return effectiveSkaters('home', s) > effectiveSkaters('away', s);
    }
}

export function matchPlayerStrength(e: GameEvent, side: Side, f: PlayerStrength): boolean {
    const own = effectiveSkaters(side, e.situation);
    const opp = effectiveSkaters(other(side), e.situation);
    switch (f) {
        case 'all':
            return true;
        case '5v5':
            return e.fiveOnFive;
        case 'ev':
            return own === opp;
        case 'pp':
            return own > opp;
        case 'sh':
            return own < opp;
    }
}

export const inPeriod = (e: GameEvent, p: PeriodFilter) => p === 'all' || (p === 4 ? e.period >= 4 : e.period === p);

/* ── Team totals ──────────────────────────────────────────────────────── */

export interface TeamTotals {
    goals: number;
    xg: number;
    sog: number;
    unblocked: number;
    attempts: number;
    hd: number;
    faceoffs: number;
    hits: number;
    blocks: number;
    giveaways: number;
    takeaways: number;
    pim: number;
}

const zero = (): TeamTotals => ({ goals: 0, xg: 0, sog: 0, unblocked: 0, attempts: 0, hd: 0, faceoffs: 0, hits: 0, blocks: 0, giveaways: 0, takeaways: 0, pim: 0 });

export function teamTotals(events: GameEvent[], f: TeamStrength, period: PeriodFilter, adjusted = false): Record<Side, TeamTotals> {
    const out = { away: zero(), home: zero() };
    for (const e of events) {
        if (!inPeriod(e, period) || !matchTeamStrength(e, f)) continue;
        const t = out[e.side];
        const w = adjusted ? attemptWeight(e) : 1;
        switch (e.type) {
            case 'goal':
                t.goals += 1;
                break;
            case 'faceoff':
                t.faceoffs += 1;
                break;
            case 'hit':
                t.hits += 1;
                break;
            case 'giveaway':
                t.giveaways += 1;
                break;
            case 'takeaway':
                t.takeaways += 1;
                break;
            case 'penalty':
                t.pim += e.minutes ?? 0;
                break;
            case 'block':
                // The blocking team gets the block; the shooting team the attempt.
                out[other(e.side)].blocks += 1;
                break;
        }
        if (isAttempt(e)) t.attempts += w;
        if (isUnblocked(e)) {
            t.unblocked += w;
            if (e.xg != null) {
                t.xg += e.xg * (adjusted ? xgWeight(e) : 1);
                if (e.xg >= HD_XG) t.hd += 1;
            }
        }
        if (isOnGoal(e)) t.sog += w;
    }
    return out;
}

/** Goals and shots on goal by period (the line score). */
export function lineScore(m: GameModel): { period: number; label: string; goals: Record<Side, number>; sog: Record<Side, number> }[] {
    const last = Math.max(3, ...m.events.map(e => e.period));
    const rows = [];
    for (let p = 1; p <= last; p++) {
        const evs = m.events.filter(e => e.period === p);
        rows.push({
            period: p,
            label: p <= 3 ? String(p) : p === 4 ? 'OT' : `${p - 3}OT`,
            goals: { away: evs.filter(e => e.type === 'goal' && e.side === 'away').length, home: evs.filter(e => e.type === 'goal' && e.side === 'home').length },
            sog: { away: evs.filter(e => isOnGoal(e) && e.side === 'away').length, home: evs.filter(e => isOnGoal(e) && e.side === 'home').length },
        });
    }
    return rows;
}

/* ── Pulse: per-minute bins and running totals ─────────────────────────── */

export type FlowMetric = 'xg' | 'attempts' | 'unblocked' | 'sog' | 'goals';

export function metricValue(e: GameEvent, metric: FlowMetric): number {
    switch (metric) {
        case 'xg':
            return isUnblocked(e) ? (e.xg ?? 0) : 0;
        case 'attempts':
            return isAttempt(e) ? 1 : 0;
        case 'unblocked':
            return isUnblocked(e) ? 1 : 0;
        case 'sog':
            return isOnGoal(e) ? 1 : 0;
        case 'goals':
            return e.type === 'goal' ? 1 : 0;
    }
}

/** Per-minute totals for each side, minute 0 .. ceil(end / 60). */
export function perMinute(m: GameModel, metric: FlowMetric, f: TeamStrength = 'all'): Record<Side, number[]> {
    const n = Math.max(60, Math.ceil(Math.max(m.end, 1) / 60));
    const out = { away: new Array(n).fill(0), home: new Array(n).fill(0) };
    for (const e of m.events) {
        if (!matchTeamStrength(e, f)) continue;
        const v = metricValue(e, metric);
        if (v) out[e.side][Math.min(n - 1, Math.floor(e.t / 60))] += v;
    }
    return out;
}

/** Step series of the running total: [t, value] at every change, from 0 to the end. */
export function race(m: GameModel, metric: FlowMetric, f: TeamStrength = 'all'): Record<Side, [number, number][]> {
    const out: Record<Side, [number, number][]> = { away: [[0, 0]], home: [[0, 0]] };
    const sum = { away: 0, home: 0 };
    for (const e of m.events) {
        if (!matchTeamStrength(e, f)) continue;
        const v = metricValue(e, metric);
        if (!v) continue;
        sum[e.side] += v;
        out[e.side].push([e.t, sum[e.side]]);
    }
    for (const s of SIDES) out[s].push([Math.max(m.end, 1), sum[s]]);
    return out;
}

/** Power-play windows: [start, end, side on the power play], from the on-ice skater counts. */
export function powerPlays(m: GameModel): [number, number, Side][] {
    const segs = segments(m);
    const out: [number, number, Side][] = [];
    for (const s of segs) {
        const a = s.skaters.away.length;
        const h = s.skaters.home.length;
        // Empty-net extra attackers are not power plays.
        if (!s.goalie.away || !s.goalie.home || a === h || a < 3 || h < 3) continue;
        const side: Side = a > h ? 'away' : 'home';
        const last = out[out.length - 1];
        if (last && last[2] === side && last[1] === s.a) last[1] = s.b;
        else out.push([s.a, s.b, side]);
    }
    return out.filter(([a, b]) => b - a >= 5);
}

/* ── Win probability ───────────────────────────────────────────────────
 * Goals still to come are Poisson at the pregame expected-goal rates scaled
 * to the time left; a tie after regulation goes to OT at a coin flip leaning
 * 40% of the way toward the pregame favourite. The pregame pony xG win
 * probability anchors the start: its logit gap to the Poisson start is added
 * and fades out with the clock.
 */

const LEAGUE_XG = 3.05;

function poisson(lambda: number, k: number): number {
    let p = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) p *= lambda / i;
    return p;
}

/** P(home wins) with `left` of regulation remaining (0..1), home leading by `d`. */
function poissonHome(d: number, left: number, lh: number, la: number, pOT: number): number {
    const h = lh * left;
    const a = la * left;
    let win = 0;
    let tie = 0;
    const N = 12;
    const ph = Array.from({ length: N }, (_, k) => poisson(h, k));
    const pa = Array.from({ length: N }, (_, k) => poisson(a, k));
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const diff = d + i - j;
            if (diff > 0) win += ph[i] * pa[j];
            else if (diff === 0) tie += ph[i] * pa[j];
        }
    }
    return win + tie * pOT;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));

export interface WinModel {
    at: (t: number, homeLead: number) => number;
}

export function winModel(m: GameModel): WinModel {
    const pg = m.pregame;
    const lh = pg?.homeXg ?? LEAGUE_XG;
    const la = pg?.awayXg ?? LEAGUE_XG;
    const p0 = pg?.homeWin ?? null;
    const pOT = 0.5 + 0.4 * ((p0 ?? 0.5) - 0.5);
    const start = poissonHome(0, 1, lh, la, pOT);
    const shift = p0 != null ? logit(clampP(p0)) - logit(clampP(start)) : 0;
    return {
        at(t, homeLead) {
            if (t >= 3600) {
                if (homeLead !== 0) return homeLead > 0 ? 1 : 0;
                return pOT;
            }
            const left = (3600 - t) / 3600;
            const p = poissonHome(homeLead, left, lh, la, pOT);
            if (p <= 0 || p >= 1) return p;
            return sigmoid(logit(clampP(p)) + shift * left);
        },
    };
}

/** Home win probability as a step series: every 30s and at every goal. */
export function winSeries(m: GameModel): [number, number][] {
    const wm = winModel(m);
    const goals = m.events.filter(e => e.type === 'goal');
    const pts: [number, number][] = [];
    const end = Math.max(m.end, 1);
    const lead = (t: number) => goals.filter(g => g.t <= t).reduce((d, g) => d + (g.side === 'home' ? 1 : -1), 0);
    const ts = new Set<number>();
    for (let t = 0; t < Math.min(end, 3600); t += 30) ts.add(t);
    for (const g of goals) {
        ts.add(Math.max(0, g.t - 0.01));
        ts.add(g.t);
    }
    ts.add(end);
    for (const t of [...ts].sort((a, b) => a - b)) pts.push([t, wm.at(t, lead(t))]);
    if (m.state === 'final') {
        const hs = m.teams.home.score;
        const as = m.teams.away.score;
        pts.push([end, hs > as ? 1 : 0]);
    }
    return pts;
}

export interface GoalSwing {
    event: GameEvent;
    before: number;
    after: number;
}

/** Home win probability just before and after each goal. */
export function goalSwings(m: GameModel): GoalSwing[] {
    const wm = winModel(m);
    let lead = 0;
    const out: GoalSwing[] = [];
    const goals = m.events.filter(e => e.type === 'goal');
    for (const g of goals) {
        const before = wm.at(g.t, lead);
        lead += g.side === 'home' ? 1 : -1;
        // An overtime goal ends the game: at() returns 1 or 0 past regulation.
        out.push({ event: g, before, after: wm.at(g.t, lead) });
    }
    return out;
}

/**
 * The "deserved" home win probability from the shots so far: every unblocked
 * attempt is a coin with its pony xG, goals are the sum of those coins
 * (Poisson-binomial), and a level game splits evenly. Steps at every shot.
 * Where it parts from the score line, finishing and goaltending made the
 * difference.
 */
export function deservedSeries(m: GameModel): [number, number][] {
    const dist: Record<Side, number[]> = { away: [1], home: [1] };
    const pHome = () => {
        let win = 0;
        let tie = 0;
        let cdfAway = 0;
        for (let h = 0; h < dist.home.length; h++) {
            const ph = dist.home[h];
            tie += ph * (dist.away[h] ?? 0);
            win += ph * cdfAway;
            cdfAway += dist.away[h] ?? 0;
        }
        return win + tie / 2;
    };
    const out: [number, number][] = [[0, 0.5]];
    for (const e of m.events) {
        if (!isUnblocked(e) || e.xg == null || e.xg <= 0) continue;
        const p = Math.min(0.99, e.xg);
        const d = dist[e.side];
        const next = new Array(d.length + 1).fill(0);
        for (let k = 0; k < d.length; k++) {
            next[k] += d[k] * (1 - p);
            next[k + 1] += d[k] * p;
        }
        dist[e.side] = next;
        out.push([e.t, pHome()]);
    }
    out.push([Math.max(m.end, 1), out[out.length - 1][1]]);
    return out;
}

/** Period number and seconds into it for game time t (any number of overtimes). */
export function periodAt(t: number, otLength: number): { period: number; into: number } {
    if (t < 3600) return { period: Math.floor(t / 1200) + 1, into: t % 1200 };
    const k = Math.floor((t - 3600) / otLength);
    return { period: 4 + k, into: t - 3600 - k * otLength };
}

/* ── On-ice segments ───────────────────────────────────────────────────── */

export interface Segment {
    a: number;
    b: number;
    skaters: Record<Side, number[]>;
    goalie: Record<Side, number | null>;
}

const segCache = new WeakMap<GameModel, Segment[]>();

/** The game cut at every line change: who is on the ice in each stretch. */
export function segments(m: GameModel): Segment[] {
    const hit = segCache.get(m);
    if (hit) return hit;
    const byId = new Map(m.players.map(p => [p.id, p]));
    const bounds = new Set<number>();
    const list: { id: number; s: Shift }[] = [];
    for (const [id, shifts] of Object.entries(m.shifts)) {
        for (const s of shifts) {
            bounds.add(s[0]);
            bounds.add(s[1]);
            list.push({ id: Number(id), s });
        }
    }
    const pts = [...bounds].sort((x, y) => x - y);
    list.sort((x, y) => x.s[0] - y.s[0]);
    const out: Segment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const seg: Segment = { a, b, skaters: { away: [], home: [] }, goalie: { away: null, home: null } };
        for (const { id, s } of list) {
            if (s[0] > a) break;
            if (s[1] <= a) continue;
            const p = byId.get(id);
            if (!p) continue;
            if (p.pos === 'G') seg.goalie[p.side] = id;
            else if (!seg.skaters[p.side].includes(id)) seg.skaters[p.side].push(id);
        }
        if (seg.skaters.away.length || seg.skaters.home.length) out.push(seg);
    }
    segCache.set(m, out);
    return out;
}

/** Segment index covering game time t (binary search). */
function segAt(segs: Segment[], t: number): Segment | null {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].b <= t) lo = mid + 1;
        else if (segs[mid].a > t) hi = mid - 1;
        else return segs[mid];
    }
    return null;
}

/** Who was on the ice for an event: players starting their shift on a faceoff are on for it; otherwise the stretch just before. */
export function onIce(m: GameModel, e: GameEvent): Segment | null {
    return segAt(segments(m), e.type === 'faceoff' ? e.t + 0.5 : e.t - 0.5);
}

const segStrength = (s: Segment, side: Side): 'ev' | 'pp' | 'sh' => {
    const own = s.skaters[side].length;
    const opp = s.skaters[other(side)].length;
    return own > opp ? 'pp' : own < opp ? 'sh' : 'ev';
};
const segFive = (s: Segment) => s.skaters.away.length === 5 && s.skaters.home.length === 5 && s.goalie.away != null && s.goalie.home != null;

function segMatches(s: Segment, side: Side, f: PlayerStrength): boolean {
    switch (f) {
        case 'all':
            return true;
        case '5v5':
            return segFive(s);
        case 'ev':
            return segStrength(s, side) === 'ev';
        case 'pp':
            return segStrength(s, side) === 'pp';
        case 'sh':
            return segStrength(s, side) === 'sh';
    }
}

/* ── Skaters ───────────────────────────────────────────────────────────── */

export interface SkaterRow {
    player: Player;
    toi: number;
    toiEv: number;
    toiPp: number;
    toiSh: number;
    /** Share of the game's clock, 0..1. */
    toiPct: number;
    g: number;
    a1: number;
    a2: number;
    sog: number;
    iCF: number;
    iFF: number;
    ixg: number;
    hits: number;
    blocks: number;
    giveaways: number;
    takeaways: number;
    foW: number;
    foL: number;
    pim: number;
    plusMinus: number;
    shifts: number;
    /** On ice. */
    cf: number;
    ca: number;
    ff: number;
    fa: number;
    sf: number;
    sa: number;
    gf: number;
    ga: number;
    xgf: number;
    xga: number;
    /** TOI-weighted average of opponents' and teammates' TOI share on the ice with him (quality of competition / teammates). */
    qoc: number | null;
    qot: number | null;
}

export function skaterRows(m: GameModel, side: Side, f: PlayerStrength, period: PeriodFilter = 'all'): SkaterRow[] {
    const segs = segments(m).filter(s => (period === 'all' ? true : periodOf(s.a) === period) && segMatches(s, side, f));
    const length = Math.max(m.end, 1);
    const toiAll = new Map<number, number>();
    for (const s of segments(m)) for (const sd of SIDES) for (const id of s.skaters[sd]) toiAll.set(id, (toiAll.get(id) ?? 0) + (s.b - s.a));
    const share = (id: number) => (toiAll.get(id) ?? 0) / length;

    const rows = new Map<number, SkaterRow>();
    const row = (p: Player) => {
        let r = rows.get(p.id);
        if (!r) {
            const box = m.box[p.id];
            r = {
                player: p,
                toi: 0,
                toiEv: 0,
                toiPp: 0,
                toiSh: 0,
                toiPct: 0,
                g: 0,
                a1: 0,
                a2: 0,
                sog: 0,
                iCF: 0,
                iFF: 0,
                ixg: 0,
                hits: 0,
                blocks: 0,
                giveaways: 0,
                takeaways: 0,
                foW: 0,
                foL: 0,
                pim: box?.pim ?? 0,
                plusMinus: box?.plusMinus ?? 0,
                shifts: box?.shifts ?? (m.shifts[p.id]?.length ?? 0),
                cf: 0,
                ca: 0,
                ff: 0,
                fa: 0,
                sf: 0,
                sa: 0,
                gf: 0,
                ga: 0,
                xgf: 0,
                xga: 0,
                qoc: null,
                qot: null,
            };
            rows.set(p.id, r);
        }
        return r;
    };
    const byId = new Map(m.players.map(p => [p.id, p]));
    for (const p of m.players) if (p.side === side && p.pos !== 'G' && m.shifts[p.id]) row(p);

    const qoc = new Map<number, [number, number]>();
    const qot = new Map<number, [number, number]>();
    for (const s of segs) {
        const len = s.b - s.a;
        const st = segStrength(s, side);
        for (const id of s.skaters[side]) {
            const p = byId.get(id);
            if (!p) continue;
            const r = row(p);
            r.toi += len;
            if (st === 'ev') r.toiEv += len;
            else if (st === 'pp') r.toiPp += len;
            else r.toiSh += len;
            const c = qoc.get(id) ?? [0, 0];
            for (const o of s.skaters[other(side)]) {
                c[0] += share(o) * len;
                c[1] += len;
            }
            qoc.set(id, c);
            const tm = qot.get(id) ?? [0, 0];
            for (const o of s.skaters[side]) {
                if (o === id) continue;
                tm[0] += share(o) * len;
                tm[1] += len;
            }
            qot.set(id, tm);
        }
    }

    for (const e of m.events) {
        if (!inPeriod(e, period)) continue;
        const ice = onIce(m, e);
        if (!ice || !segMatches(ice, side, f)) continue;
        // Individual
        const mine = e.side === side;
        if (mine && e.player != null) {
            const p = byId.get(e.player);
            if (p && p.pos !== 'G' && p.side === side) {
                const r = row(p);
                if (e.type === 'goal') r.g += 1;
                if (isOnGoal(e)) r.sog += 1;
                if (isAttempt(e)) r.iCF += 1;
                if (isUnblocked(e)) {
                    r.iFF += 1;
                    r.ixg += e.xg ?? 0;
                }
                if (e.type === 'hit') r.hits += 1;
                if (e.type === 'giveaway') r.giveaways += 1;
                if (e.type === 'takeaway') r.takeaways += 1;
                if (e.type === 'faceoff') r.foW += 1;
            }
        }
        if (mine && e.type === 'goal') {
            e.assists.forEach((id, i) => {
                const p = byId.get(id);
                if (p && p.side === side) row(p)[i === 0 ? 'a1' : 'a2'] += 1;
            });
        }
        if (!mine && e.type === 'faceoff' && e.other != null) {
            const p = byId.get(e.other);
            if (p && p.side === side) row(p).foL += 1;
        }
        if (!mine && e.type === 'block' && e.other != null) {
            const p = byId.get(e.other);
            if (p && p.side === side) row(p).blocks += 1;
        }
        // On ice
        if (!isAttempt(e)) continue;
        for (const id of ice.skaters[side]) {
            const p = byId.get(id);
            if (!p) continue;
            const r = row(p);
            if (mine) {
                r.cf += 1;
                if (isUnblocked(e)) {
                    r.ff += 1;
                    r.xgf += e.xg ?? 0;
                }
                if (isOnGoal(e)) r.sf += 1;
                if (e.type === 'goal') r.gf += 1;
            } else {
                r.ca += 1;
                if (isUnblocked(e)) {
                    r.fa += 1;
                    r.xga += e.xg ?? 0;
                }
                if (isOnGoal(e)) r.sa += 1;
                if (e.type === 'goal') r.ga += 1;
            }
        }
    }
    const out = [...rows.values()];
    for (const r of out) {
        r.toiPct = r.toi / length;
        const c = qoc.get(r.player.id);
        const t = qot.get(r.player.id);
        r.qoc = c && c[1] ? c[0] / c[1] : null;
        r.qot = t && t[1] ? t[0] / t[1] : null;
    }
    return out.sort((x, y) => y.toi - x.toi);
}

function periodOf(t: number): number {
    return t < 3600 ? Math.floor(t / 1200) + 1 : 4;
}

/* ── Units: forward lines, D pairs, PP and PK groups ───────────────────── */

export interface Unit {
    ids: number[];
    toi: number;
    cf: number;
    ca: number;
    xgf: number;
    xga: number;
    gf: number;
    ga: number;
    /** Shots on goal for / against. */
    sf: number;
    sa: number;
    /** Separate stints together (consecutive stretches merge into one). */
    stints: number;
    /** Stints that began on a faceoff, by zone from this side's view. */
    oz: number;
    nz: number;
    dz: number;
}

export type UnitKind = 'F' | 'D' | 'PP' | 'PK';

export function units(m: GameModel, side: Side, kind: UnitKind, per: PeriodFilter = 'all'): Unit[] {
    const byId = new Map(m.players.map(p => [p.id, p]));
    const segs = segments(m);
    const acc = new Map<string, Unit>();
    const keyOf = (s: Segment): string | null => {
        const sk = s.skaters[side];
        if (kind === 'F' || kind === 'D') {
            if (!segFive(s)) return null;
            const ids = sk.filter(id => (byId.get(id)?.pos === 'D') === (kind === 'D'));
            if (ids.length !== (kind === 'D' ? 2 : 3)) return null;
            return ids.sort((a, b) => a - b).join('-');
        }
        if (!s.goalie.away || !s.goalie.home) return null;
        const st = segStrength(s, side);
        if ((kind === 'PP' && st !== 'pp') || (kind === 'PK' && st !== 'sh')) return null;
        return [...sk].sort((a, b) => a - b).join('-');
    };
    const faceoffAt = new Map<number, GameEvent>();
    for (const e of m.events) if (e.type === 'faceoff') faceoffAt.set(e.t, e);
    let prev: { k: string | null; b: number } = { k: null, b: -1 };
    for (const s of segs) {
        const k = keyOf(s);
        // A stint continues across a change elsewhere on the ice, not across an intermission.
        const cont = k != null && prev.k === k && prev.b === s.a && periodOf(s.a) === periodOf(prev.b - 0.01);
        prev = { k, b: s.b };
        if (!k || (per !== 'all' && periodOf(s.a) !== per)) continue;
        const u = acc.get(k) ?? { ids: k.split('-').map(Number), toi: 0, cf: 0, ca: 0, xgf: 0, xga: 0, gf: 0, ga: 0, sf: 0, sa: 0, stints: 0, oz: 0, nz: 0, dz: 0 };
        u.toi += s.b - s.a;
        if (!cont) {
            u.stints += 1;
            const fo = faceoffAt.get(s.a);
            if (fo?.zone) {
                const z = fo.side === side ? fo.zone : fo.zone === 'O' ? 'D' : fo.zone === 'D' ? 'O' : 'N';
                if (z === 'O') u.oz += 1;
                else if (z === 'D') u.dz += 1;
                else u.nz += 1;
            }
        }
        acc.set(k, u);
    }
    for (const e of m.events) {
        if (!isAttempt(e) || !inPeriod(e, per)) continue;
        const ice = onIce(m, e);
        if (!ice) continue;
        const k = keyOf(ice);
        const u = k ? acc.get(k) : null;
        if (!u) continue;
        const mine = e.side === side;
        if (mine) {
            u.cf += 1;
            u.xgf += isUnblocked(e) ? (e.xg ?? 0) : 0;
            u.gf += e.type === 'goal' ? 1 : 0;
            u.sf += isOnGoal(e) ? 1 : 0;
        } else {
            u.ca += 1;
            u.xga += isUnblocked(e) ? (e.xg ?? 0) : 0;
            u.ga += e.type === 'goal' ? 1 : 0;
            u.sa += isOnGoal(e) ? 1 : 0;
        }
    }
    return [...acc.values()].sort((a, b) => b.toi - a.toi);
}

/* ── 5v5 head-to-head matchups ─────────────────────────────────────────── */

export interface Matchup {
    toi: number;
    /** xG for the away / home side while both were on the ice. */
    xg: Record<Side, number>;
    /** Shot attempts (incl. blocked) and goals per side over the same time. */
    att: Record<Side, number>;
    g: Record<Side, number>;
}

/** away skater id -> home skater id -> 5v5 time together and xG each way. */
export function matchups(m: GameModel): Map<number, Map<number, Matchup>> {
    const out = new Map<number, Map<number, Matchup>>();
    const cell = (a: number, h: number) => {
        let row = out.get(a);
        if (!row) out.set(a, (row = new Map()));
        let c = row.get(h);
        if (!c) row.set(h, (c = { toi: 0, xg: { away: 0, home: 0 }, att: { away: 0, home: 0 }, g: { away: 0, home: 0 } }));
        return c;
    };
    for (const s of segments(m)) {
        if (!segFive(s)) continue;
        for (const a of s.skaters.away) for (const h of s.skaters.home) cell(a, h).toi += s.b - s.a;
    }
    for (const e of m.events) {
        if (!(isUnblocked(e) || e.type === 'block') || !e.fiveOnFive) continue;
        const ice = onIce(m, e);
        if (!ice || !segFive(ice)) continue;
        for (const a of ice.skaters.away)
            for (const h of ice.skaters.home) {
                const c = cell(a, h);
                c.att[e.side] += 1;
                if (e.xg != null && isUnblocked(e)) c.xg[e.side] += e.xg;
                if (e.type === 'goal') c.g[e.side] += 1;
            }
    }
    return out;
}

/* ── Zone starts ───────────────────────────────────────────────────────── */

export interface ZoneStarts {
    /** Shift starts on a faceoff, by zone and period (index 0 = 1st, 1 = 2nd, 2 = 3rd/OT). */
    O: [number, number, number];
    N: [number, number, number];
    D: [number, number, number];
    /** Shift starts on the fly (no faceoff at that second). */
    fly: [number, number, number];
}

export function zoneStarts(m: GameModel, side: Side): Map<number, ZoneStarts> {
    const byId = new Map(m.players.map(p => [p.id, p]));
    const faceoffAt = new Map<number, GameEvent>();
    for (const e of m.events) if (e.type === 'faceoff') faceoffAt.set(e.t, e);
    const out = new Map<number, ZoneStarts>();
    for (const [idStr, shifts] of Object.entries(m.shifts)) {
        const id = Number(idStr);
        const p = byId.get(id);
        if (!p || p.side !== side || p.pos === 'G') continue;
        const z: ZoneStarts = { O: [0, 0, 0], N: [0, 0, 0], D: [0, 0, 0], fly: [0, 0, 0] };
        for (const [a] of shifts) {
            const pi = Math.min(2, Math.floor(a / 1200));
            const fo = faceoffAt.get(a);
            if (fo && fo.zone) {
                const zone = fo.side === side ? fo.zone : fo.zone === 'O' ? 'D' : fo.zone === 'D' ? 'O' : 'N';
                z[zone][pi] += 1;
            } else z.fly[pi] += 1;
        }
        out.set(id, z);
    }
    return out;
}

/* ── Goalies ───────────────────────────────────────────────────────────── */

export interface GoalieRow {
    player: Player;
    toi: number;
    sa: number;
    ga: number;
    xga: number;
    /** Unblocked attempts faced. */
    fa: number;
    hdSa: number;
    hdGa: number;
    /** xG of the high-danger unblocked attempts faced (same basis as xGA). */
    hdXga: number;
    byStrength: Record<'ev' | 'pp' | 'sh', { sa: number; ga: number; xga: number }>;
}

export function goalieRows(m: GameModel, side: Side): GoalieRow[] {
    const goalies = m.players.filter(p => p.side === side && p.pos === 'G' && m.shifts[p.id]);
    return goalies
        .map(p => {
            const r: GoalieRow = {
                player: p,
                toi: (m.shifts[p.id] ?? []).reduce((a, [s, e]) => a + e - s, 0),
                sa: 0,
                ga: 0,
                xga: 0,
                fa: 0,
                hdSa: 0,
                hdGa: 0,
                hdXga: 0,
                byStrength: { ev: { sa: 0, ga: 0, xga: 0 }, pp: { sa: 0, ga: 0, xga: 0 }, sh: { sa: 0, ga: 0, xga: 0 } },
            };
            for (const e of m.events) {
                if (e.side === side || !isUnblocked(e) || e.other !== p.id) continue;
                // Strength from the goalie's side.
                const st = e.strength === 'pp' ? 'sh' : e.strength === 'sh' ? 'pp' : 'ev';
                r.fa += 1;
                r.xga += e.xg ?? 0;
                r.byStrength[st].xga += e.xg ?? 0;
                if ((e.xg ?? 0) >= HD_XG) r.hdXga += e.xg ?? 0;
                if (isOnGoal(e)) {
                    r.sa += 1;
                    r.byStrength[st].sa += 1;
                    if ((e.xg ?? 0) >= HD_XG) r.hdSa += 1;
                }
                if (e.type === 'goal') {
                    r.ga += 1;
                    r.byStrength[st].ga += 1;
                    if ((e.xg ?? 0) >= HD_XG) r.hdGa += 1;
                }
            }
            return r;
        })
        .sort((a, b) => b.toi - a.toi);
}

/* ── Formatting ────────────────────────────────────────────────────────── */

export const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const periodLabel = (p: number) => (p <= 3 ? ['1st', '2nd', '3rd'][p - 1] : p === 4 ? 'OT' : `${p - 3}OT`);
export const playerName = (p: Player | undefined) => (p ? `${p.first} ${p.last}` : '—');
export const shortName = (p: Player | undefined) => (p ? `${p.first.charAt(0)}. ${p.last}` : '—');

/* ── One skater against each opponent and with each teammate ───────────── */

export interface PairRow {
    player: Player;
    toi: number;
    cf: number;
    ca: number;
    xgf: number;
    xga: number;
    gf: number;
    ga: number;
}

/**
 * For one skater: time and on-ice results with every opponent (competition)
 * and every teammate, under the player-side strength and period filters.
 * "For" is always the chosen skater's team.
 */
export function pairRows(m: GameModel, playerId: number, f: PlayerStrength, period: PeriodFilter = 'all'): { opp: PairRow[]; mates: PairRow[] } {
    const byId = new Map(m.players.map(p => [p.id, p]));
    const me = byId.get(playerId);
    if (!me) return { opp: [], mates: [] };
    const side = me.side;
    const acc = { opp: new Map<number, PairRow>(), mates: new Map<number, PairRow>() };
    const row = (kind: 'opp' | 'mates', id: number) => {
        let r = acc[kind].get(id);
        if (!r) {
            const p = byId.get(id);
            if (!p) return null;
            r = { player: p, toi: 0, cf: 0, ca: 0, xgf: 0, xga: 0, gf: 0, ga: 0 };
            acc[kind].set(id, r);
        }
        return r;
    };
    const ok = (s: Segment, t: number) => s.skaters[side].includes(playerId) && segMatches(s, side, f) && (period === 'all' || (period === 4 ? t >= 3600 : periodOf(t) === period));
    for (const s of segments(m)) {
        if (!ok(s, s.a)) continue;
        for (const id of s.skaters[other(side)]) row('opp', id)!.toi += s.b - s.a;
        for (const id of s.skaters[side]) if (id !== playerId) row('mates', id)!.toi += s.b - s.a;
    }
    for (const e of m.events) {
        if (!isAttempt(e)) continue;
        const ice = onIce(m, e);
        if (!ice || !ok(ice, e.t)) continue;
        const mine = e.side === side;
        const xg = isUnblocked(e) ? (e.xg ?? 0) : 0;
        const goal = e.type === 'goal' ? 1 : 0;
        const add = (r: PairRow | null) => {
            if (!r) return;
            if (mine) {
                r.cf += 1;
                r.xgf += xg;
                r.gf += goal;
            } else {
                r.ca += 1;
                r.xga += xg;
                r.ga += goal;
            }
        };
        for (const id of ice.skaters[other(side)]) add(row('opp', id));
        for (const id of ice.skaters[side]) if (id !== playerId) add(row('mates', id));
    }
    const sort = (list: PairRow[]) => list.filter(r => r.toi > 0).sort((a, b) => b.toi - a.toi);
    return { opp: sort([...acc.opp.values()]), mates: sort([...acc.mates.values()]) };
}

/** Last names, with an initial wherever two players in the game share one (M. Tkachuk, B. Tkachuk). */
export function nameLabels(players: Player[]): Map<number, string> {
    const count = new Map<string, number>();
    for (const p of players) count.set(p.last, (count.get(p.last) ?? 0) + 1);
    return new Map(players.map(p => [p.id, (count.get(p.last) ?? 0) > 1 ? `${p.first.charAt(0)}. ${p.last}` : p.last]));
}

/* ── Market results ────────────────────────────────────────────────────── */

export type Hit = 'hit' | 'miss' | 'push';

export interface MarketResults {
    ml: Record<Side, Hit>;
    puckline: Record<Side, Hit | null>;
    over: Hit | null;
    under: Hit | null;
    firstPeriod: Record<Side, Hit>;
    threeWay: { away: Hit; tie: Hit; home: Hit };
    firstPeriodThreeWay: { away: Hit; tie: Hit; home: Hit };
}

const grade = (d: number): Hit => (d > 0 ? 'hit' : d < 0 ? 'miss' : 'push');

/** How every pregame market settled (final games). Final score includes the shootout winner's +1, as books grade it. */
export function marketResults(m: GameModel): MarketResults | null {
    if (m.state !== 'final') return null;
    const s = { away: m.teams.away.score, home: m.teams.home.score };
    const goalsIn = (pred: (e: GameEvent) => boolean) => ({
        away: m.events.filter(e => e.type === 'goal' && e.side === 'away' && pred(e)).length,
        home: m.events.filter(e => e.type === 'goal' && e.side === 'home' && pred(e)).length,
    });
    const reg = goalsIn(e => e.t < 3600);
    const p1 = goalsIn(e => e.period === 1);
    const three = (g: Record<Side, number>) => ({
        away: g.away > g.home ? ('hit' as Hit) : 'miss',
        tie: g.away === g.home ? ('hit' as Hit) : 'miss',
        home: g.home > g.away ? ('hit' as Hit) : 'miss',
    });
    const pl = m.odds?.puckline;
    const total = m.odds?.total;
    return {
        ml: { away: s.away > s.home ? 'hit' : 'miss', home: s.home > s.away ? 'hit' : 'miss' },
        puckline: {
            away: pl?.away ? grade(s.away - s.home + pl.away.spread) : null,
            home: pl?.home ? grade(s.home - s.away + pl.home.spread) : null,
        },
        over: total ? grade(s.away + s.home - total.line) : null,
        under: total ? grade(total.line - (s.away + s.home)) : null,
        // Two-way first-period moneyline pushes on a tie.
        firstPeriod: { away: grade(p1.away - p1.home), home: grade(p1.home - p1.away) },
        threeWay: three(reg),
        firstPeriodThreeWay: three(p1),
    };
}

/* ── Strength states over time ─────────────────────────────────────────── */

export type StateKind = 'pp' | 'reduced' | 'extra';

/** Merged windows of special strength: a power play (side with the extra skater), 4v4 / 3v3, and an extra attacker for a pulled goalie (that side). */
export function strengthStates(m: GameModel): { a: number; b: number; kind: StateKind; side: Side | null; label: string }[] {
    const out: { a: number; b: number; kind: StateKind; side: Side | null; label: string }[] = [];
    for (const s of segments(m)) {
        const a = s.skaters.away.length;
        const h = s.skaters.home.length;
        let kind: StateKind | null = null;
        let side: Side | null = null;
        let label = '';
        if (!s.goalie.away || !s.goalie.home) {
            if (s.goalie.away && s.goalie.home) continue;
            kind = 'extra';
            side = !s.goalie.away ? 'away' : 'home';
            // The real counts: 6v5 at even strength, 6v4 when the goalie comes out on a power play.
            label = `${s.skaters[side].length}v${s.skaters[other(side)].length}`;
        } else if (a !== h && a >= 3 && h >= 3) {
            kind = 'pp';
            side = a > h ? 'away' : 'home';
            label = `${Math.max(a, h)}v${Math.min(a, h)}`;
        } else if (a === h && a < 5 && a >= 3) {
            kind = 'reduced';
            label = `${a}v${h}`;
        }
        if (!kind) continue;
        const last = out[out.length - 1];
        if (last && last.kind === kind && last.side === side && last.b === s.a) last.b = s.b;
        else out.push({ a: s.a, b: s.b, kind, side, label });
    }
    return out.filter(w => w.b - w.a >= 5);
}

/* ── Player usage (lines, pairs, units, markers) ──────────────────────── */

/** Even-strength seconds every two skaters of a side spent on the ice together, keyed "lo-hi". */
export function pairTimes(m: GameModel, side: Side): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of segments(m)) {
        if (!s.goalie.away || !s.goalie.home || s.skaters.away.length !== s.skaters.home.length) continue;
        const ids = s.skaters[side];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const k = ids[i] < ids[j] ? `${ids[i]}-${ids[j]}` : `${ids[j]}-${ids[i]}`;
                out.set(k, (out.get(k) ?? 0) + (s.b - s.a));
            }
        }
    }
    return out;
}
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Each forward on one line and each defender on one pair, like a coach's
 * lineup card: 5v5 trios / pairs taken greedily by time together, then the
 * rest by even-strength time.
 */
export function lineup(m: GameModel, side: Side): { forwards: number[][]; defense: number[][] } {
    const rows = skaterRows(m, side, 'ev');
    const take = (kind: 'F' | 'D', size: number, count: number) => {
        const used = new Set<number>();
        const out: number[][] = [];
        for (const u of units(m, side, kind)) {
            if (out.length >= count) break;
            if (u.ids.some(id => used.has(id))) continue;
            out.push(u.ids);
            u.ids.forEach(id => used.add(id));
        }
        const rest = rows.filter(r => (r.player.pos === 'D') === (kind === 'D') && !used.has(r.player.id)).map(r => r.player.id);
        while (out.length < count && rest.length) out.push(rest.splice(0, size));
        // Order lines by even-strength time of their players.
        const toi = new Map(rows.map(r => [r.player.id, r.toi]));
        return out.map(ids => [...ids].sort((a, b) => (toi.get(b) ?? 0) - (toi.get(a) ?? 0))).sort((a, b) => b.reduce((s, id) => s + (toi.get(id) ?? 0), 0) - a.reduce((s, id) => s + (toi.get(id) ?? 0), 0));
    };
    return { forwards: take('F', 3, 4), defense: take('D', 2, 3) };
}

export type MarkerKind = 'gf' | 'ga' | 'goal' | 'a1';

/**
 * Goal markers for one skater in a strength context: 'es' = even strength and
 * any empty-net time (the lines and pairs), 'pp' = his team's power play,
 * 'sh' = his team's penalty kill. When, and what (his goal, his primary
 * assist, another team goal for, a goal against).
 */
export function goalMarkers(m: GameModel, playerId: number, side: Side, ctx: 'es' | 'pp' | 'sh'): { t: number; kind: MarkerKind }[] {
    const out: { t: number; kind: MarkerKind }[] = [];
    for (const e of m.events) {
        if (e.type !== 'goal') continue;
        const ice = onIce(m, e);
        if (!ice || !ice.skaters[side].includes(playerId)) continue;
        const empty = !ice.goalie.away || !ice.goalie.home;
        const here = empty ? 'es' : segStrength(ice, side) === 'ev' ? 'es' : segStrength(ice, side);
        if (here !== ctx) continue;
        const mine = e.side === side;
        if (mine && e.player === playerId) out.push({ t: e.t, kind: 'goal' });
        else if (mine && e.assists[0] === playerId) out.push({ t: e.t, kind: 'a1' });
        else out.push({ t: e.t, kind: mine ? 'gf' : 'ga' });
    }
    return out;
}

/* ── On the ice at a moment ───────────────────────────────────────────── */

export interface SkaterSnap {
    player: Player;
    /** Seconds into the current shift, its number, and game TOI so far. */
    shift: number;
    shiftNo: number;
    toi: number;
    g: number;
    a: number;
    sog: number;
    att: number;
    pim: number;
    hits: number;
    blk: number;
    fow: number;
    fol: number;
}
export interface GoalieSnap {
    player: Player;
    toi: number;
    sa: number;
    ga: number;
    xga: number;
}
export interface IceSnapshot {
    t: number;
    skaters: Record<Side, SkaterSnap[]>;
    goalie: Record<Side, GoalieSnap | null>;
}

const POS_ORDER: Record<Pos, number> = { C: 0, L: 1, R: 2, D: 3, G: 4 };

/** Who was on the ice at game time t, with each player's box score up to that moment. */
export function iceAt(m: GameModel, t: number): IceSnapshot | null {
    const seg = segAt(segments(m), Math.min(t, m.end - 0.01));
    if (!seg) return null;
    const byId = new Map(m.players.map(p => [p.id, p]));
    const shiftInfo = (id: number) => {
        const list = m.shifts[id] ?? [];
        let toi = 0;
        let shift = 0;
        let shiftNo = 0;
        list.forEach(([a, b], i) => {
            if (a >= t) return;
            toi += Math.min(b, t) - a;
            if (b > t) {
                shift = Math.min(b, t) - a;
                shiftNo = i + 1;
            }
        });
        return { toi, shift, shiftNo };
    };
    const past = m.events.filter(e => e.t <= t);
    const skater = (id: number): SkaterSnap | null => {
        const player = byId.get(id);
        if (!player) return null;
        const r: SkaterSnap = { player, ...shiftInfo(id), g: 0, a: 0, sog: 0, att: 0, pim: 0, hits: 0, blk: 0, fow: 0, fol: 0 };
        for (const e of past) {
            if (e.player === id) {
                if (e.type === 'goal') r.g += 1;
                if (isOnGoal(e)) r.sog += 1;
                if (isUnblocked(e) || e.type === 'block') r.att += 1;
                if (e.type === 'penalty') r.pim += e.minutes ?? 0;
                if (e.type === 'hit') r.hits += 1;
                if (e.type === 'faceoff') r.fow += 1;
            }
            if (e.other === id) {
                if (e.type === 'block') r.blk += 1;
                if (e.type === 'faceoff') r.fol += 1;
            }
            if (e.type === 'goal' && e.assists.includes(id)) r.a += 1;
        }
        return r;
    };
    const goalie = (side: Side): GoalieSnap | null => {
        const id = seg.goalie[side];
        const player = id != null ? byId.get(id) : undefined;
        if (!player || id == null) return null;
        const r: GoalieSnap = { player, toi: shiftInfo(id).toi, sa: 0, ga: 0, xga: 0 };
        for (const e of past) {
            if (e.side === side || !isUnblocked(e) || e.other !== id) continue;
            r.xga += e.xg ?? 0;
            if (isOnGoal(e)) r.sa += 1;
            if (e.type === 'goal') r.ga += 1;
        }
        return r;
    };
    const skaters = (side: Side) =>
        seg.skaters[side]
            .map(skater)
            .filter((r): r is SkaterSnap => r != null)
            .sort((p, q) => POS_ORDER[p.player.pos] - POS_ORDER[q.player.pos] || (p.player.num ?? 0) - (q.player.num ?? 0));
    return { t, skaters: { away: skaters('away'), home: skaters('home') }, goalie: { away: goalie('away'), home: goalie('home') } };
}
