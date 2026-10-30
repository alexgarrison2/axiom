/*
 * A skater's form for the /players row drawer: his games of one season
 * (from the Pony Score file, served by app/players/skaters/[id]) and the
 * per-game splits over the season and its last 5 / 10 / 20. Pure, so the
 * drawer only lays things out.
 */

export interface FormGame {
    game: number;
    date: string;
    opp: string;
    home: boolean;
    result: 'W' | 'L' | 'OTL';
    /** His team's goals and the opponent's. */
    gf: number;
    ga: number;
    g: number;
    a: number;
    sog: number;
    ixg: number;
    /** Seconds: all situations, power play, penalty kill. */
    toi: number;
    toiPp: number;
    toiPk: number;
    /** Pony Score: goals above an average player at his position. */
    ps: number;
    /** 5v5 on-ice pony xG for and against; null for a game stored before them. */
    xgf5: number | null;
    xga5: number | null;
}

export interface Form {
    /** Pony season id, e.g. "20262027". */
    season: string;
    /** Oldest first. */
    games: FormGame[];
}

/** Per-game averages over a run of games. */
export interface Split {
    gp: number;
    pts: number;
    sog: number;
    ixg: number;
    toi: number;
    toiPp: number;
    /** 5v5 on-ice xG share, 0..100; null without a sample. */
    xgPct: number | null;
    ps: number;
}

export function split(games: FormGame[], last?: number): Split | null {
    const rows = last ? games.slice(-last) : games;
    const n = rows.length;
    if (!n) return null;
    const avg = (f: (g: FormGame) => number) => rows.reduce((s, g) => s + f(g), 0) / n;
    const on = rows.filter(g => g.xgf5 != null && g.xga5 != null);
    const xgf = on.reduce((s, g) => s + g.xgf5!, 0);
    const xga = on.reduce((s, g) => s + g.xga5!, 0);
    return {
        gp: n,
        pts: avg(g => g.g + g.a),
        sog: avg(g => g.sog),
        ixg: avg(g => g.ixg),
        toi: avg(g => g.toi),
        toiPp: avg(g => g.toiPp),
        xgPct: xgf + xga > 0 ? (100 * xgf) / (xgf + xga) : null,
        ps: avg(g => g.ps),
    };
}

export type SplitKey = Exclude<keyof Split, 'gp'>;

/**
 * How far a window has to sit from the season before it reads as a trend
 * (per game; TOI in seconds, xG share in points): roughly a third of what
 * separates a first-line forward from a third-liner.
 */
export const TREND: Record<SplitKey, number> = { pts: 0.3, sog: 0.75, ixg: 0.12, toi: 60, toiPp: 45, xgPct: 6, ps: 0.15 };

/** Up or down against the season, or null inside the band. */
export function trend(w: Split, season: Split, key: SplitKey): 'up' | 'down' | null {
    const a = w[key];
    const b = season[key];
    if (a == null || b == null) return null;
    if (a - b >= TREND[key]) return 'up';
    if (b - a >= TREND[key]) return 'down';
    return null;
}
