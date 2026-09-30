/** Compact skater rows for /players (built on the server from player_impact.json). */

export interface Skater {
    id: string;
    name: string;
    team: string;
    /** Team the ratings were earned with, when the player has since moved. */
    prevTeam: string | null;
    pos: string;
    fwd: boolean;
    onRoster: boolean;
    rookie: boolean;
    gp: number;
    g: number;
    a: number;
    pts: number;
    sogPg: number | null;
    toiPg: number | null;
    impact: number | null;
    evOff: number | null;
    evDef: number | null;
    pp: number | null;
    pk: number | null;
    rapm: number | null;
    ixg60: number | null;
    oixgf60: number | null;
}

type Obj = Record<string, unknown>;
const num = (v: unknown, digits = 2): number | null => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

export function compactSkaters(impact: unknown, bio: unknown): Skater[] {
    if (!impact || typeof impact !== 'object') return [];
    const bios = (bio && typeof bio === 'object' ? bio : {}) as Record<string, Obj>;
    const out: Skater[] = [];
    for (const [id, raw] of Object.entries(impact as Record<string, Obj>)) {
        if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') continue;
        const team = String(raw.team ?? '');
        const prev = typeof raw.team_prev === 'string' && raw.team_prev && raw.team_prev !== team ? raw.team_prev : null;
        out.push({
            id,
            name: raw.name,
            team,
            prevTeam: prev,
            pos: String(raw.position ?? ''),
            fwd: raw.is_forward === true,
            onRoster: raw.on_roster !== false,
            rookie: bios[id]?.isRookie === true,
            gp: Number(raw.games_played ?? 0) || 0,
            g: Number(raw.goals ?? 0) || 0,
            a: Number(raw.assists ?? 0) || 0,
            pts: Number(raw.points ?? 0) || 0,
            sogPg: num(raw.sog_per_game),
            toiPg: num(raw.toi_per_game_all),
            impact: num(raw.impact_score),
            evOff: num(raw.impact_ev_off),
            evDef: num(raw.impact_ev_def),
            pp: num(raw.impact_pp),
            pk: num(raw.impact_pk),
            rapm: num(raw.rapm_net, 3),
            ixg60: num(raw.ind_xg_per60),
            oixgf60: num(raw.ev_xgf_per60),
        });
    }
    return out;
}

export type SortKey = 'impact' | 'gp' | 'g' | 'a' | 'pts' | 'sogPg' | 'toiPg' | 'evOff' | 'evDef' | 'pp' | 'pk' | 'rapm' | 'ixg60' | 'oixgf60' | 'name';

export interface SkaterFilter {
    q: string;
    team: string;
    pos: 'all' | 'F' | 'D';
    minGp: number;
    rookies: boolean;
    includeOffRoster: boolean;
}

export function filterSkaters(rows: Skater[], f: SkaterFilter): Skater[] {
    const q = f.q.trim().toLowerCase();
    return rows.filter(p => {
        if (p.gp < f.minGp) return false;
        if (!f.includeOffRoster && !p.onRoster) return false;
        if (f.pos === 'F' && !p.fwd) return false;
        if (f.pos === 'D' && p.fwd) return false;
        if (f.team !== 'all' && p.team !== f.team) return false;
        if (f.rookies && !p.rookie) return false;
        if (q && !p.name.toLowerCase().includes(q) && p.team.toLowerCase() !== q) return false;
        return true;
    });
}

export function sortSkaters(rows: Skater[], key: SortKey, dir: 'asc' | 'desc'): Skater[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (key === 'name') return sign * a.name.localeCompare(b.name);
        const av = a[key] as number | null;
        const bv = b[key] as number | null;
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // missing values always last
        if (bv == null) return -1;
        return sign * (av - bv) || a.name.localeCompare(b.name);
    });
}
