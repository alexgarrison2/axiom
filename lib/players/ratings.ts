/**
 * The site's player ratings (public/data/player_ratings.json, exported by
 * pipeline/bu/lineup/ratings_export.py), read by column name so v2, v3 and v4
 * files all parse (a column the file lacks is undefined).
 *
 * v3 / v4 headline, goals per 82 games above the F / D average:
 *   impact      off_impact + def_impact
 *   off_impact  EV + PP offence, finishing, penalties drawn
 *   def_impact  EV + PK defence, minus penalties taken
 *   pen_impact  (v4) penalties drawn minus taken, inside off / def_impact
 * Per-60 detail (every rating higher = better):
 *   ev_off / ev_def  EV xGF/60 added, xGA/60 prevented (v2 names: off / def)
 *   pp_off / pk_def  PP xGF/60 added, PK xGA/60 prevented (not position-centred)
 *   fin              shrunk EV goals above xG per 60 on his own shots
 *   net              off + def (the v2 headline; team pages and lineups still use it)
 * Production (appended to v4; descriptive, not a rating):
 *   prod   recency-weighted Game Score per 82 games above the F / D average
 *   gs_pg  the shrunk Game Score per game behind it
 *
 * Pure helpers (no fs) shared by /players, the team pages, the teams table
 * and the matchup Lines tab.
 */

export interface PlayerRating {
    id: number;
    name: string;
    team: string;
    pos: string;
    roster: boolean;
    /** False: no NHL sample yet (the rookie prior of his position group). */
    rated: boolean;
    /** EV xGF/60 above an average skater (column ev_off, v2: off). */
    off: number;
    /** EV xGA/60 prevented, higher is better (column ev_def, v2: def). */
    def: number;
    /** off + def. */
    net: number;
    /** Shrunk EV finishing: goals above xG per 60 from his own shots. Absent in files without the column. */
    fin?: number;
    /** off + fin. Absent when the file has no finishing column. */
    offTotal?: number;
    /** EV minutes / games behind the rating (last three seasons + this one). */
    toi: number;
    gp: number;
    toiCur: number;
    gpCur: number;
    /** v3+: goals per 82 games above the position (F / D) average = offImpact + defImpact. */
    impact?: number;
    offImpact?: number;
    defImpact?: number;
    /** v3+: posterior SD of impact. */
    sd?: number;
    /** v3+: PP xGF/60 added vs an average PP skater (not position-centred). */
    ppOff?: number;
    /** v3+: PK xGA/60 prevented vs an average PK skater (not position-centred). */
    pkDef?: number;
    /** v3+: expected minutes per game at EV, on the PP and on the PK. */
    toiEvGp?: number;
    toiPpGp?: number;
    toiPkGp?: number;
    /** v4: goals per 82 from penalties drawn minus taken vs his position (inside offImpact / defImpact). */
    penImpact?: number;
    /** v4: penalties drawn / taken per 60 (power-play units). */
    pd60?: number;
    pt60?: number;
    /** Production score: recency-weighted Game Score per 82 games above the F / D average (descriptive). */
    prod?: number;
    /** Recency-weighted Game Score per game, shrunk (the level behind prod). */
    gsPg?: number;
}

/** Per-60 columns with a position (F / D) mean in v3+ files. */
export type RateKey = 'ev_off' | 'ev_def' | 'pp_off' | 'pk_def' | 'fin' | 'pd60' | 'pt60';
export type PositionMeans = Record<'F' | 'D', Partial<Record<RateKey, number>>>;

export interface RatingsMeta {
    /** File version (2: EV per 60 only, 3: + per-game impact, 4: + penalties and a box-score prior). */
    version: number | null;
    season: string | null;
    seasonLabel: string | null;
    /** Games through this date are in the ratings (YYYY-MM-DD). */
    asOf: string | null;
    /** v3+: the TOI-weighted F / D means the impact centres every per-60 rate on. */
    positionMeans: PositionMeans | null;
}

export interface Ratings extends RatingsMeta {
    byId: Map<number, PlayerRating>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, d = 0) => (isNum(v) ? v : d);
/** An optional numeric column: undefined when the column is missing or the cell is not a finite number. */
const opt = (r: unknown[], i: number): number | undefined => (i >= 0 && isNum(r[i]) ? r[i] : undefined);

function parseMeans(impact: unknown): PositionMeans | null {
    const pm = impact && typeof impact === 'object' ? (impact as { position_means?: unknown }).position_means : null;
    if (!pm || typeof pm !== 'object') return null;
    const group = (g: unknown) => {
        const out: Partial<Record<RateKey, number>> = {};
        if (g && typeof g === 'object') for (const [k, v] of Object.entries(g)) if (isNum(v)) out[k as RateKey] = v;
        return out;
    };
    const { F, D } = pm as { F?: unknown; D?: unknown };
    return { F: group(F), D: group(D) };
}

/** 'F' for C / L / R, 'D' for defencemen. */
export const posGroup = (pos: string): 'F' | 'D' => (pos === 'D' ? 'D' : 'F');

export function parseRatings(doc: unknown): Ratings {
    const empty: Ratings = { version: null, season: null, seasonLabel: null, asOf: null, positionMeans: null, byId: new Map() };
    if (!doc || typeof doc !== 'object') return empty;
    const d = doc as { columns?: unknown; rows?: unknown; version?: unknown; season?: unknown; season_label?: unknown; as_of?: unknown; impact?: unknown };
    if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return empty;
    const ix = (c: string) => (d.columns as unknown[]).indexOf(c);
    /** v3+ name, else the v2 name. */
    const either = (a: string, b: string) => (ix(a) >= 0 ? ix(a) : ix(b));
    const I = {
        id: ix('id'),
        name: ix('name'),
        team: ix('team'),
        pos: ix('pos'),
        roster: ix('roster'),
        rated: ix('rated'),
        off: either('ev_off', 'off'),
        def: either('ev_def', 'def'),
        net: ix('net'),
        toi: ix('toi'),
        gp: ix('gp'),
        toiCur: ix('toi_cur'),
        gpCur: ix('gp_cur'),
        fin: ix('fin'),
        offTotal: ix('off_total'),
        impact: ix('impact'),
        offImpact: ix('off_impact'),
        defImpact: ix('def_impact'),
        sd: ix('sd'),
        ppOff: ix('pp_off'),
        pkDef: ix('pk_def'),
        toiEvGp: ix('toi_ev_gp'),
        toiPpGp: ix('toi_pp_gp'),
        toiPkGp: ix('toi_pk_gp'),
        penImpact: ix('pen_impact'),
        pd60: ix('pd60'),
        pt60: ix('pt60'),
        prod: ix('prod'),
        gsPg: ix('gs_pg'),
    };
    if (I.id < 0 || I.off < 0 || I.def < 0) return empty;
    const byId = new Map<number, PlayerRating>();
    for (const r of d.rows as unknown[][]) {
        if (!Array.isArray(r)) continue;
        const id = Number(r[I.id]);
        const off = r[I.off];
        const def = r[I.def];
        if (!Number.isFinite(id) || !isNum(off) || !isNum(def)) continue;
        const fin = opt(r, I.fin);
        const offImpact = opt(r, I.offImpact);
        const defImpact = opt(r, I.defImpact);
        byId.set(id, {
            id,
            name: String(r[I.name] ?? ''),
            team: String(r[I.team] ?? ''),
            pos: String(r[I.pos] ?? ''),
            roster: r[I.roster] === true,
            rated: r[I.rated] !== false,
            off,
            def,
            net: opt(r, I.net) ?? off + def,
            toi: num(r[I.toi]),
            gp: num(r[I.gp]),
            toiCur: num(r[I.toiCur]),
            gpCur: num(r[I.gpCur]),
            fin,
            offTotal: opt(r, I.offTotal) ?? (fin == null ? undefined : off + fin),
            impact: opt(r, I.impact) ?? (offImpact != null && defImpact != null ? offImpact + defImpact : undefined),
            offImpact,
            defImpact,
            sd: opt(r, I.sd),
            ppOff: opt(r, I.ppOff),
            pkDef: opt(r, I.pkDef),
            toiEvGp: opt(r, I.toiEvGp),
            toiPpGp: opt(r, I.toiPpGp),
            toiPkGp: opt(r, I.toiPkGp),
            penImpact: opt(r, I.penImpact),
            pd60: opt(r, I.pd60),
            pt60: opt(r, I.pt60),
            prod: opt(r, I.prod),
            gsPg: opt(r, I.gsPg),
        });
    }
    return {
        version: isNum(d.version) ? d.version : null,
        season: typeof d.season === 'string' ? d.season : null,
        seasonLabel: typeof d.season_label === 'string' ? d.season_label : null,
        asOf: typeof d.as_of === 'string' ? d.as_of : null,
        positionMeans: parseMeans(d.impact),
        byId,
    };
}

/** "SEP 30" from "2026-09-30" (UTC date, no time zone shift). */
export function asOfLabel(asOf: string | null | undefined): string | null {
    const m = asOf?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(m[2]) - 1];
    return mon ? `${mon} ${Number(m[3])}` : null;
}

export function foldName(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’-]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
}

/**
 * Name lookup for sources without NHL ids (DailyFaceoff lines): exact folded
 * full name, preferring the player's own team; else same team + first initial
 * + surname. Never a bare surname, so two Tkachuks never share a rating.
 * `def` (the lineup slot: defence pair or forward line) breaks a tie
 * between two same-named teammates (VAN's two Elias Petterssons).
 */
export function nameIndex(r: Ratings) {
    const byFull = new Map<string, PlayerRating[]>();
    const byTeamLast = new Map<string, PlayerRating[]>();
    for (const p of r.byId.values()) {
        if (!p.name) continue;
        const n = foldName(p.name);
        (byFull.get(n) ?? byFull.set(n, []).get(n)!).push(p);
        const k = `${p.team}|${n.split(' ').at(-1)}`;
        (byTeamLast.get(k) ?? byTeamLast.set(k, []).get(k)!).push(p);
    }
    /** The one candidate, or the one at the slot's position when two share the name. */
    const pick = (cands: PlayerRating[], def?: boolean): PlayerRating | null => {
        if (cands.length === 1) return cands[0];
        if (def == null || cands.length === 0) return null;
        const at = cands.filter(p => (p.pos === 'D') === def);
        return at.length === 1 ? at[0] : null;
    };
    return (name: string, team: string, id?: number | string | null, def?: boolean): PlayerRating | null => {
        if (id != null && id !== '') {
            const hit = r.byId.get(Number(id));
            if (hit) return hit;
        }
        const n = foldName(name);
        const full = byFull.get(n);
        if (full?.length) {
            const own = full.filter(p => p.team === team);
            if (own.length) return pick(own, def);
            const rostered = full.filter(p => p.roster);
            return full.length === 1 ? full[0] : rostered.length === 1 ? rostered[0] : pick(rostered, def);
        }
        const parts = n.split(' ');
        const cands = (byTeamLast.get(`${team}|${parts.at(-1)}`) ?? []).filter(p => foldName(p.name).charAt(0) === (parts[0] ?? '').charAt(0));
        return pick(cands, def);
    };
}

/** Signed with a real minus sign: "+0.71", "−0.20". */
export function signed(v: number, digits = 2): string {
    const r = Number(v.toFixed(digits));
    if (r === 0) return (0).toFixed(digits);
    return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)}`;
}
