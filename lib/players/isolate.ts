/*
 * Isolated impact (public/data/isolate/<season>.json, pipeline/bu/isolate): pure parsing,
 * percentiles and number formatting, shared by the server loader and the client chart.
 */

export interface IsolateGrid {
    /** First exported row's distance from the centre line (ft); rows run toward the end boards. */
    x0: number;
    /** Cell size (ft). */
    cell: number;
    /** Rows (along the rink, x) and columns (across, y). */
    nx: number;
    ny: number;
    /** Left edge of column 0 (ft, the shooter's right boards). */
    y0: number;
    sigma: number;
}

export interface IsolateDoc {
    version: number;
    season: string;
    window: string[];
    asof: string;
    half_life_days: number;
    grid: IsolateGrid;
    std: { ev: number; pp: number; pk: number };
    league: { ev_xg: number; ev_sh: number; pp_xg: number; pp_sh: number; minor_value: number };
    /** Shots/60 per cell per code unit, per map type. */
    scale: Record<MapType, number>;
    /** Contour thresholds in that type's codes (quantiles of the league's cells), low to high. */
    levels: Record<MapType, number[]>;
    columns: string[];
    rows: unknown[][];
}

export type MapKey = 'evOff' | 'evDef' | 'pp' | 'pk';
export type MapType = 'ev_off' | 'ev_def' | 'pp' | 'pk';
export const MAP_TYPE: Record<MapKey, MapType> = { evOff: 'ev_off', evDef: 'ev_def', pp: 'pp', pk: 'pk' };
/** The distributions beside the parts: goal threat (finishing, shooting) and penalties (drawn, taken). */
export type DistKey = 'fin' | 'shoot' | 'draw' | 'take';
export type PartKey = 'evOff' | 'evDef' | 'pp' | 'pk' | 'fin' | 'draw' | 'take';
export const PART_KEYS: PartKey[] = ['evOff', 'evDef', 'pp', 'pk', 'fin', 'draw', 'take'];
export const PART_LABEL: Record<PartKey, string> = {
    evOff: '5v5 offence',
    evDef: '5v5 defence',
    pp: 'Power play',
    pk: 'Penalty kill',
    fin: 'Finishing',
    draw: 'Drawing',
    take: 'Taking',
};

export interface IsolatePlayer {
    id: number;
    pos: 'F' | 'D';
    /** Window minutes by state, and 5v5 minutes in the season itself. */
    toi: number;
    toiCur: number;
    toiPp: number;
    toiPk: number;
    /** xG/60 impacts: offence + = more for, defence + = more against. */
    evOff: number;
    evDef: number;
    ppOff: number;
    pkDef: number;
    /** Unblocked shots/60 impacts (the sums of the 5v5 maps). */
    evOffSh: number;
    evDefSh: number;
    /** Goals over a standard season, signed so + is good for his team. */
    goals: Record<PartKey | 'total', number>;
    finX: number;
    drawn60: number;
    taken60: number;
    /** 5v5 individual xG per 60 (his own shots), shrunk: display only, inside 5v5 offence already. */
    ixg60: number;
    /** Map cells as int8 codes, row-major from x0 toward the end boards; null = too little time in the state. */
    maps: Record<MapKey, number[] | null>;
}

export interface IsolateView {
    season: string;
    window: string[];
    asof: string;
    grid: IsolateGrid;
    std: IsolateDoc['std'];
    league: IsolateDoc['league'];
    scale: IsolateDoc['scale'];
    levels: IsolateDoc['levels'];
    player: IsolatePlayer;
    /** Percentile (0-100) among qualified skaters of his position; null when he is not qualified. */
    pct: Record<PartKey | 'total', number | null>;
    /** Qualified skaters of his position (the percentile base). */
    peers: number;
    /** League (his position, qualified) density of each distribution metric, with his value and rank. */
    dists: Record<DistKey, Dist>;
}

export interface Dist {
    /** Axis range and the density sampled evenly across it (peak = 1). */
    lo: number;
    hi: number;
    dens: number[];
    value: number;
    /** League (position) median. */
    mid: number;
    /** Percentile with "good" up: for taken, the share of peers who take more. */
    pct: number | null;
}

/** Gaussian kernel density of `values` on `n` points over [lo, hi] (Silverman bandwidth), peak-normalised. */
export function density(values: number[], lo: number, hi: number, n = 48): number[] {
    const v = values.filter(Number.isFinite);
    if (v.length < 2 || !(hi > lo)) return Array.from({ length: n }, () => 0);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) || (hi - lo) / 10;
    const s = [...v].sort((a, b) => a - b);
    const iqr = quantile(s, 0.75) - quantile(s, 0.25);
    const h = 0.9 * Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) * v.length ** -0.2;
    const out = Array.from({ length: n }, (_, i) => {
        const x = lo + ((hi - lo) * i) / (n - 1);
        let d = 0;
        for (const y of v) d += Math.exp(-0.5 * ((x - y) / h) ** 2);
        return d;
    });
    const top = Math.max(...out);
    return out.map(d => (top > 0 ? d / top : 0));
}

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted: number[], q: number): number {
    if (!sorted.length) return 0;
    const at = (sorted.length - 1) * q;
    const i = Math.floor(at);
    const f = at - i;
    return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

/** Minutes of 5v5 in the window below which the maps read as a thin sample. */
export const THIN_MIN = 500;

/** base64 int8 -> numbers (works in node and the browser). */
export function decodeCodes(s: string): number[] | null {
    if (!s) return null;
    const bin = atob(s);
    const out = new Array<number>(bin.length);
    for (let i = 0; i < bin.length; i++) {
        const b = bin.charCodeAt(i);
        out[i] = b > 127 ? b - 256 : b;
    }
    return out;
}

function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

function rowToPlayer(cols: string[], r: unknown[]): IsolatePlayer {
    const g = (k: string) => r[cols.indexOf(k)];
    return {
        id: num(g('id')),
        pos: g('pos') === 'D' ? 'D' : 'F',
        toi: num(g('toi')),
        toiCur: num(g('toi_cur')),
        toiPp: num(g('toi_pp')),
        toiPk: num(g('toi_pk')),
        evOff: num(g('ev_off')),
        evDef: num(g('ev_def')),
        ppOff: num(g('pp_off')),
        pkDef: num(g('pk_def')),
        evOffSh: num(g('ev_off_sh')),
        evDefSh: num(g('ev_def_sh')),
        goals: {
            evOff: num(g('g_ev_off')),
            evDef: num(g('g_ev_def')),
            pp: num(g('g_pp')),
            pk: num(g('g_pk')),
            fin: num(g('g_fin')),
            draw: num(g('g_draw')),
            take: num(g('g_take')),
            total: num(g('g_total')),
        },
        finX: num(g('fin_x')) || 1,
        drawn60: num(g('drawn60')),
        taken60: num(g('taken60')),
        ixg60: num(g('ixg60')),
        maps: {
            evOff: decodeCodes(String(g('m_ev_off') ?? '')),
            evDef: decodeCodes(String(g('m_ev_def') ?? '')),
            pp: decodeCodes(String(g('m_pp') ?? '')),
            pk: decodeCodes(String(g('m_pk') ?? '')),
        },
    };
}

/** Share (0-100) of `values` at or below `v`, rounded; mid-rank for ties. */
export function percentile(values: number[], v: number): number {
    if (!values.length) return 50;
    let below = 0;
    let equal = 0;
    for (const x of values) {
        if (x < v) below++;
        else if (x === v) equal++;
    }
    return Math.round(((below + equal / 2) / values.length) * 100);
}

/** One skater's view of a season file, or null when he is not in it. */
export function isolateFor(doc: IsolateDoc | null, id: number): IsolateView | null {
    if (!doc?.columns || !Array.isArray(doc.rows)) return null;
    const cols = doc.columns;
    const idAt = cols.indexOf('id');
    const raw = doc.rows.find(r => num(r[idAt]) === id);
    if (!raw) return null;
    const player = rowToPlayer(cols, raw);
    const posAt = cols.indexOf('pos');
    const toiAt = cols.indexOf('toi');
    const peers = doc.rows.filter(r => (r[posAt] === 'D' ? 'D' : 'F') === player.pos && num(r[toiAt]) >= THIN_MIN);
    const qualified = player.toi >= THIN_MIN;
    const keys: [PartKey | 'total', string][] = [
        ['evOff', 'g_ev_off'],
        ['evDef', 'g_ev_def'],
        ['pp', 'g_pp'],
        ['pk', 'g_pk'],
        ['fin', 'g_fin'],
        ['draw', 'g_draw'],
        ['take', 'g_take'],
        ['total', 'g_total'],
    ];
    const pct = {} as IsolateView['pct'];
    for (const [k, c] of keys) {
        const at = cols.indexOf(c);
        pct[k] = qualified ? percentile(peers.map(r => num(r[at])), player.goals[k]) : null;
    }
    const distCol: Record<DistKey, [string, number, boolean]> = {
        fin: ['fin_x', player.finX, true],
        shoot: ['ixg60', player.ixg60, true],
        draw: ['drawn60', player.drawn60, true],
        take: ['taken60', player.taken60, false],
    };
    const dists = {} as Record<DistKey, Dist>;
    for (const k of Object.keys(distCol) as DistKey[]) {
        const [c, value, up] = distCol[k];
        const at = cols.indexOf(c);
        const vals = at < 0 ? [] : peers.map(r => num(r[at])).filter(Number.isFinite);
        const s = [...vals].sort((a, b) => a - b);
        // axis: the 1st-99th percentile of the league, widened to keep his dot inside
        let lo = Math.min(quantile(s, 0.01), value);
        let hi = Math.max(quantile(s, 0.99), value);
        const pad = (hi - lo) * 0.06 || 0.01;
        lo -= pad;
        hi += pad;
        dists[k] = {
            lo,
            hi,
            dens: density(vals, lo, hi),
            value,
            mid: quantile(s, 0.5),
            pct: qualified && vals.length ? percentile(up ? vals : vals.map(v => -v), up ? value : -value) : null,
        };
    }
    return {
        season: doc.season,
        window: doc.window,
        asof: doc.asof,
        grid: doc.grid,
        std: doc.std,
        league: doc.league,
        scale: doc.scale,
        levels: doc.levels,
        player,
        pct,
        peers: peers.length,
        dists,
    };
}

/* ── formatting ─────────────────────────────────────────────────────────── */

/** Signed with a true minus: +0.42, −0.10, 0.00. */
export function sgn(v: number, d = 2): string {
    const r = Number(Math.abs(v).toFixed(d));
    if (r === 0) return (0).toFixed(d);
    return `${v > 0 ? '+' : '−'}${r.toFixed(d)}`;
}

/** Signed whole percent: +17%, −4%, 0%. */
export function sgnPct(v: number): string {
    const r = Math.round(v * 100);
    return r === 0 ? '0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, ... */
export function ordinal(n: number): string {
    const m100 = n % 100;
    const s = m100 >= 11 && m100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
    return `${n}${s}`;
}

/** Thousands with a thin separator-free comma: 4,574. */
export function minutes(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

/** "24-25 – 26-27" for a window of season ids (one season: "25-26"). */
export function windowLabel(seasons: string[]): string {
    const short = (s: string) => `${s.slice(2, 4)}-${s.slice(6, 8)}`;
    if (!seasons.length) return '';
    return seasons.length === 1 ? short(seasons[0]) : `${short(seasons[0])} – ${short(seasons[seasons.length - 1])}`;
}
