/**
 * The site's one player rating: RAPM v2 at even strength, per 60 minutes
 * (public/data/player_ratings.json, exported by pipeline/bu/lineup/ratings_export.py).
 *
 *   OFF  xG for per 60 above an average skater (higher is better)
 *   DEF  xG against per 60 prevented vs average (higher is better)
 *   NET  OFF + DEF
 *   FIN  goals above xG per 60 from his own shots, shrunk (finishing; not in NET)
 *   OFF+FIN  OFF + FIN
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
    off: number;
    /** xGA/60 prevented (higher is better). */
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
}

export interface RatingsMeta {
    season: string | null;
    seasonLabel: string | null;
    /** Games through this date are in the ratings (YYYY-MM-DD). */
    asOf: string | null;
}

export interface Ratings extends RatingsMeta {
    byId: Map<number, PlayerRating>;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** An optional numeric column: undefined when the column is missing or the cell is not a finite number. */
const opt = (r: unknown[], i: number): number | undefined => (i >= 0 && typeof r[i] === 'number' && Number.isFinite(r[i]) ? (r[i] as number) : undefined);

export function parseRatings(doc: unknown): Ratings {
    const empty: Ratings = { season: null, seasonLabel: null, asOf: null, byId: new Map() };
    if (!doc || typeof doc !== 'object') return empty;
    const d = doc as { columns?: unknown; rows?: unknown; season?: unknown; season_label?: unknown; as_of?: unknown };
    if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return empty;
    const ix = (c: string) => (d.columns as unknown[]).indexOf(c);
    const I = { id: ix('id'), name: ix('name'), team: ix('team'), pos: ix('pos'), roster: ix('roster'), rated: ix('rated'), off: ix('off'), def: ix('def'), net: ix('net'), toi: ix('toi'), gp: ix('gp'), toiCur: ix('toi_cur'), gpCur: ix('gp_cur'), fin: ix('fin'), offTotal: ix('off_total') };
    if (I.id < 0 || I.off < 0 || I.def < 0) return empty;
    const byId = new Map<number, PlayerRating>();
    for (const r of d.rows as unknown[][]) {
        if (!Array.isArray(r)) continue;
        const id = Number(r[I.id]);
        const off = r[I.off];
        const def = r[I.def];
        if (!Number.isFinite(id) || typeof off !== 'number' || typeof def !== 'number') continue;
        const fin = opt(r, I.fin);
        const offTotal = opt(r, I.offTotal) ?? (fin == null ? undefined : off + fin);
        byId.set(id, {
            id,
            name: String(r[I.name] ?? ''),
            team: String(r[I.team] ?? ''),
            pos: String(r[I.pos] ?? ''),
            roster: r[I.roster] === true,
            rated: r[I.rated] !== false,
            off,
            def,
            net: typeof r[I.net] === 'number' ? (r[I.net] as number) : off + def,
            toi: num(r[I.toi]),
            gp: num(r[I.gp]),
            toiCur: num(r[I.toiCur]),
            gpCur: num(r[I.gpCur]),
            fin,
            offTotal,
        });
    }
    return {
        season: typeof d.season === 'string' ? d.season : null,
        seasonLabel: typeof d.season_label === 'string' ? d.season_label : null,
        asOf: typeof d.as_of === 'string' ? d.as_of : null,
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
