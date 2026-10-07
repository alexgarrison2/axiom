import type { GoalieGame, PonyGame, SkaterGame } from '@/lib/pony/data';

/*
 * The player page's game log: per-game derivations (score line, rates),
 * the TOTAL / PER GP footer for the games shown, and the few values worth a
 * quiet highlight. Pure, so the table component only lays things out.
 */

export const mmss = (s: number) => {
    const t = Math.round(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Share of a for/against pair, 0..100, or null with nothing either way. */
export const share = (f: number, a: number): number | null => (f + a > 0 ? (100 * f) / (f + a) : null);

/** ".923", a perfect night "1.000"; null without shots. */
export function svPct(sa: number, ga: number): string | null {
    return sa > 0 ? ((sa - ga) / sa).toFixed(3).replace(/^0/, '') : null;
}

/** "4–2" from the player's team's side. */
export function scoreLine(g: PonyGame | undefined, team: string): string | null {
    if (!g) return null;
    const home = g.home === team;
    return `${home ? g.homeScore : g.awayScore}–${home ? g.awayScore : g.homeScore}`;
}

/** Takes draws: two or more faceoffs a game over the season (centres, not the odd winger). */
export function takesDraws(rows: SkaterGame[]): boolean {
    if (!rows.length) return false;
    const fo = rows.reduce((a, r) => a + (r.box ? r.box.foW + r.box.foL : 0), 0);
    return fo / rows.length >= 2;
}

/* ── Quiet highlights: a night that stands out on its own, no ramp. ───── */

export type SkaterNotable = 'g' | 'p' | 'ppp' | 'shp' | 'sog' | 'ixg' | 'hit' | 'blk' | 'tk';
const SKATER_BAR: Record<SkaterNotable, number> = { g: 2, p: 3, ppp: 2, shp: 1, sog: 6, ixg: 1, hit: 6, blk: 4, tk: 3 };
export const notable = (k: SkaterNotable, v: number | null | undefined) => v != null && v >= SKATER_BAR[k];

/** Goalie nights: a shutout (most of the game) and a save rate of .950 on 25+ shots. */
export const shutout = (g: GoalieGame) => g.ga === 0 && g.toi >= 3000;
export const bigSaves = (g: GoalieGame) => g.sa >= 25 && (g.sa - g.ga) / g.sa >= 0.95;

/* ── Footer ───────────────────────────────────────────────────────────── */

export interface SkaterFoot {
    gp: number;
    /** W-L-OTL from the team's results. */
    record: string;
    sum: { g: number; a: number; a1: number; a2: number; p: number; ppp: number; shp: number; sog: number; att: number; ixg: number; hit: number; blk: number; tk: number; gv: number; foW: number; foL: number; pim: number; pm: number; ps: number };
    per: { g: number; a: number; p: number; ppp: number; shp: number; sog: number; att: number; ixg: number; hit: number; blk: number; tk: number; gv: number; pim: number; pm: number; toi: number; toiPp: number; toiPk: number; shifts: number | null; ps: number };
    /** Aggregate rates (0..100), null without a sample. */
    shPct: number | null;
    foPct: number | null;
    cf5: number | null;
    xgf5: number | null;
}

export function recordOf(results: ('W' | 'L' | 'OTL' | 'O' | null)[]): string {
    const w = results.filter(r => r === 'W').length;
    const l = results.filter(r => r === 'L').length;
    const o = results.filter(r => r === 'OTL' || r === 'O').length;
    return `${w}–${l}–${o}`;
}

export function skaterFoot(rows: SkaterGame[]): SkaterFoot {
    const n = rows.length;
    const sum = (f: (r: SkaterGame) => number) => rows.reduce((a, r) => a + f(r), 0);
    // Box extras: a game stored without them adds nothing (and leaves the per-game average on the games that have them).
    const boxed = rows.filter(r => r.box);
    const bsum = (f: (b: NonNullable<SkaterGame['box']>) => number) => boxed.reduce((a, r) => a + f(r.box!), 0);
    const s = {
        g: sum(r => r.g),
        a: sum(r => r.a1 + r.a2),
        a1: sum(r => r.a1),
        a2: sum(r => r.a2),
        p: sum(r => r.g + r.a1 + r.a2),
        ppp: bsum(b => b.ppp),
        shp: bsum(b => b.shp),
        sog: sum(r => r.sog),
        att: bsum(b => b.att),
        ixg: sum(r => r.ixg),
        hit: sum(r => r.hit),
        blk: sum(r => r.blk),
        tk: bsum(b => b.tk),
        gv: bsum(b => b.gv),
        foW: bsum(b => b.foW),
        foL: bsum(b => b.foL),
        pim: sum(r => r.pim),
        pm: sum(r => r.pm),
        ps: sum(r => r.ps),
    };
    const per = (v: number, of = n) => (of ? v / of : 0);
    const nb = boxed.length;
    return {
        gp: n,
        record: recordOf(rows.map(r => r.result)),
        sum: s,
        per: {
            g: per(s.g),
            a: per(s.a),
            p: per(s.p),
            ppp: per(s.ppp, nb),
            shp: per(s.shp, nb),
            sog: per(s.sog),
            att: per(s.att, nb),
            ixg: per(s.ixg),
            hit: per(s.hit),
            blk: per(s.blk),
            tk: per(s.tk, nb),
            gv: per(s.gv, nb),
            pim: per(s.pim),
            pm: per(s.pm),
            toi: per(sum(r => r.toi)),
            toiPp: per(sum(r => r.toiPp)),
            toiPk: per(sum(r => r.toiPk)),
            shifts: nb ? bsum(b => b.shifts) / nb : null,
            ps: per(s.ps),
        },
        shPct: s.sog ? (100 * s.g) / s.sog : null,
        foPct: share(s.foW, s.foL),
        cf5: share(bsum(b => b.cf5), bsum(b => b.ca5)),
        xgf5: share(bsum(b => b.xgf5), bsum(b => b.xga5)),
    };
}

export interface GoalieFoot {
    gp: number;
    /** W-L-O from his decisions. */
    record: string;
    sa: number;
    ga: number;
    xga: number;
    ps: number;
    hdSa: number;
    hdGa: number;
    evSa: number;
    evGa: number;
    pkSa: number;
    pkGa: number;
    toi: number;
    /** Goals against per 60. */
    gaa: number | null;
}

export function goalieFoot(rows: GoalieGame[]): GoalieFoot {
    const sum = (f: (r: GoalieGame) => number) => rows.reduce((a, r) => a + f(r), 0);
    const bsum = (f: (b: NonNullable<GoalieGame['box']>) => number) => rows.reduce((a, r) => a + (r.box ? f(r.box) : 0), 0);
    const toi = sum(r => r.toi);
    const ga = sum(r => r.ga);
    return {
        gp: rows.length,
        record: recordOf(rows.map(r => r.box?.decision ?? null)),
        sa: sum(r => r.sa),
        ga,
        xga: sum(r => r.xga),
        ps: sum(r => r.ps),
        hdSa: bsum(b => b.hdSa),
        hdGa: bsum(b => b.hdGa),
        evSa: bsum(b => b.evSa),
        evGa: bsum(b => b.evGa),
        pkSa: bsum(b => b.pkSa),
        pkGa: bsum(b => b.pkGa),
        toi,
        gaa: toi > 0 ? (ga * 3600) / toi : null,
    };
}
