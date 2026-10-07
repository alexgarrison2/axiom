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
    scale: { ev: number; st: number };
    columns: string[];
    rows: unknown[][];
}

export type MapKey = 'evOff' | 'evDef' | 'pp' | 'pk';
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
    /** Shots/60 per cell per code unit, per state. */
    scale: IsolateDoc['scale'];
    player: IsolatePlayer;
    /** Percentile (0-100) among qualified skaters of his position; null when he is not qualified. */
    pct: Record<PartKey | 'total', number | null>;
    /** Qualified skaters of his position (the percentile base). */
    peers: number;
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
    return {
        season: doc.season,
        window: doc.window,
        asof: doc.asof,
        grid: doc.grid,
        std: doc.std,
        league: doc.league,
        scale: doc.scale,
        player,
        pct,
        peers: peers.length,
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
