/*
 * With or without you (public/data/wowy/<season>.json, pipeline/wowy.py):
 * a skater's 5v5 samples with each of his most-used teammates, and the pure
 * geometry the chart needs (equal-unit scale, ticks, label placement).
 */

/** One 5v5 sample: seconds on ice and the pony xG for and against in it. */
export interface Sample {
    toi: number;
    xgf: number;
    xga: number;
}

export interface WowyMate {
    id: number;
    first: string;
    last: string;
    pos: string;
    /** Both on the ice. */
    together: Sample;
    /** The focus player on, this teammate off. */
    him: Sample;
    /** This teammate on, the focus player off. */
    mate: Sample;
}

export interface WowyTeam {
    team: string;
    /** All of the focus player's 5v5 time on this team. */
    all: Sample;
    /** Most time together first. */
    mates: WowyMate[];
}

export interface WowyPlayer {
    season: string;
    /** Seconds together a pair needs to be listed. */
    minToi: number;
    /** Most games any team had played when the file was built. */
    teamGp: number;
    seasonGames: number;
    /** Most 5v5 time first (a traded player has one per team). */
    teams: WowyTeam[];
}

export interface WowyDoc {
    season: string;
    min_toi: number;
    team_gp: number;
    season_games: number;
    names: Record<string, [string, string, string]>;
    on_cols: string[];
    on: (number | string)[][];
    pair_cols: string[];
    pairs: (number | string)[][];
}

const minus = (a: Sample, b: Sample): Sample => ({ toi: Math.max(0, a.toi - b.toi), xgf: Math.max(0, a.xgf - b.xgf), xga: Math.max(0, a.xga - b.xga) });

/** A columnar row as an object keyed by its column names. */
function cols(names: string[]) {
    const at = Object.fromEntries(names.map((c, i) => [c, i]));
    return (row: (number | string)[], c: string) => row[at[c]];
}

/** The focus player's teams and teammates from a season file; null when he has no listed pair. */
export function wowyFor(doc: WowyDoc | null, id: number): WowyPlayer | null {
    if (!doc?.on || !doc.pairs) return null;
    const on = cols(doc.on_cols);
    const pr = cols(doc.pair_cols);
    const all = new Map<string, Sample>();
    for (const r of doc.on) {
        all.set(`${on(r, 'player')}|${on(r, 'team')}`, { toi: Number(on(r, 'toi')), xgf: Number(on(r, 'xgf')), xga: Number(on(r, 'xga')) });
    }
    const teams = new Map<string, WowyTeam>();
    for (const r of doc.pairs) {
        const a = Number(pr(r, 'a'));
        const b = Number(pr(r, 'b'));
        if (a !== id && b !== id) continue;
        const team = String(pr(r, 'team'));
        const other = a === id ? b : a;
        const mine = all.get(`${id}|${team}`);
        const theirs = all.get(`${other}|${team}`);
        if (!mine || !theirs) continue;
        const together = { toi: Number(pr(r, 'toi')), xgf: Number(pr(r, 'xgf')), xga: Number(pr(r, 'xga')) };
        const [first = '', last = String(other), pos = ''] = doc.names[String(other)] ?? [];
        const t = teams.get(team) ?? { team, all: mine, mates: [] };
        t.mates.push({ id: other, first, last, pos, together, him: minus(mine, together), mate: minus(theirs, together) });
        teams.set(team, t);
    }
    if (!teams.size) return null;
    const list = [...teams.values()].sort((x, y) => y.all.toi - x.all.toi);
    for (const t of list) t.mates.sort((x, y) => y.together.toi - x.together.toi);
    return { season: String(doc.season), minToi: Number(doc.min_toi), teamGp: Number(doc.team_gp), seasonGames: Number(doc.season_games), teams: list };
}

/** xGF/60 and xGA/60 of a sample; null when it is too short to plot. */
export function rates(s: Sample, minToi = 1): { f: number; a: number } | null {
    if (!(s.toi >= minToi) || s.toi <= 0) return null;
    return { f: (s.xgf / s.toi) * 3600, a: (s.xga / s.toi) * 3600 };
}

/** The shortest "apart" sample worth a point: 10 minutes, or a quarter of the pair bar if that is longer. */
export const minApart = (minToi: number) => Math.max(600, minToi / 4);

/**
 * The plot scale: x = xGF/60 left to right, y = xGA/60 with less against at
 * the top. Units across and down stay within `maxRatio` of each other (1 =
 * equal units, where the differential diagonals run at 45°), so a wide, short
 * plot does not squeeze the points into a sliver; the shorter range grows
 * around its middle to fill the rest.
 */
export function equalScale(pts: { f: number; a: number }[], w: number, h: number, pad = 0.08, maxRatio = 1.6) {
    const fs = pts.map(p => p.f);
    const as = pts.map(p => p.a);
    const grow = (lo: number, hi: number) => {
        const span = Math.max(0.6, hi - lo) * (1 + 2 * pad);
        const mid = (lo + hi) / 2;
        return [mid - span / 2, mid + span / 2];
    };
    let [f0, f1] = grow(Math.min(...fs), Math.max(...fs));
    let [a0, a1] = grow(Math.min(...as), Math.max(...as));
    let kx = w / (f1 - f0);
    let ky = h / (a1 - a0);
    if (kx > ky * maxRatio) kx = ky * maxRatio;
    if (ky > kx * maxRatio) ky = kx * maxRatio;
    const fm = (f0 + f1) / 2;
    const am = (a0 + a1) / 2;
    f0 = fm - w / kx / 2;
    f1 = fm + w / kx / 2;
    a0 = am - h / ky / 2;
    a1 = am + h / ky / 2;
    return {
        kx,
        ky,
        f: [f0, f1] as const,
        a: [a0, a1] as const,
        x: (f: number) => (f - f0) * kx,
        y: (a: number) => (a - a0) * ky,
    };
}

/** Round tick values inside [lo, hi] at least `minPx` apart at `k` pixels per unit. */
export function ticks(lo: number, hi: number, k: number, minPx = 44): number[] {
    const step = [0.25, 0.5, 1, 2].find(s => s * k >= minPx) ?? 2;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
}

// ── Label placement ──────────────────────────────────────────────────────

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LabelIn {
    id: number;
    /** The point the label belongs to. */
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LabelOut {
    id: number;
    /** Top-left of the label box. */
    box: Box;
    /** True when the label sits away from its point and needs a leader line. */
    lead: boolean;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Greedy collision-free labels, in priority order: each label tries spots
 * around its point (right, left, above, below, the diagonals, then the same
 * further out with a leader line) and takes the first that stays inside
 * `bounds` and clear of every placed label, every obstacle box (points, fixed
 * text) and every other label's point. A label with no clear spot is left out
 * (null): the chart shows it on hover or tap instead.
 */
export function placeLabels(items: LabelIn[], obstacles: Box[], bounds: Box, gap = 6): (LabelOut | null)[] {
    const placed: Box[] = [];
    const anchors: Box[] = items.map(it => ({ x: it.x - 4, y: it.y - 4, w: 8, h: 8 }));
    const inside = (b: Box) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h;
    return items.map((it, i) => {
        const spots = (d: number): Box[] => [
            { x: it.x + d, y: it.y - it.h / 2, w: it.w, h: it.h },
            { x: it.x - d - it.w, y: it.y - it.h / 2, w: it.w, h: it.h },
            { x: it.x - it.w / 2, y: it.y - d - it.h, w: it.w, h: it.h },
            { x: it.x - it.w / 2, y: it.y + d, w: it.w, h: it.h },
            { x: it.x + d * 0.7, y: it.y - d * 0.7 - it.h, w: it.w, h: it.h },
            { x: it.x - d * 0.7 - it.w, y: it.y - d * 0.7 - it.h, w: it.w, h: it.h },
            { x: it.x + d * 0.7, y: it.y + d * 0.7, w: it.w, h: it.h },
            { x: it.x - d * 0.7 - it.w, y: it.y + d * 0.7, w: it.w, h: it.h },
        ];
        const tries: [Box, boolean][] = [...spots(gap).map(b => [b, false] as [Box, boolean]), ...spots(gap + 16).map(b => [b, true] as [Box, boolean]), ...spots(gap + 32).map(b => [b, true] as [Box, boolean])];
        // A leader line must not run through another label or point either.
        const crosses = (box: Box) => {
            const ex = Math.max(box.x, Math.min(box.x + box.w, it.x));
            const ey = Math.max(box.y, Math.min(box.y + box.h, it.y));
            for (let s = 1; s < 8; s++) {
                const px = it.x + ((ex - it.x) * s) / 8;
                const py = it.y + ((ey - it.y) * s) / 8;
                const dot = { x: px - 0.5, y: py - 0.5, w: 1, h: 1 };
                if (placed.some(p => overlap(p, dot) > 0) || anchors.some((a, j) => j !== i && overlap(a, dot) > 0)) return true;
            }
            return false;
        };
        for (const [box, lead] of tries) {
            if (!inside(box)) continue;
            if (placed.some(p => overlap(p, box) > 0)) continue;
            if (obstacles.some(o => overlap(o, box) > 0)) continue;
            if (anchors.some((a, j) => j !== i && overlap(a, box) > 0)) continue;
            if (lead && crosses(box)) continue;
            placed.push(box);
            return { id: it.id, box, lead };
        }
        return null;
    });
}
