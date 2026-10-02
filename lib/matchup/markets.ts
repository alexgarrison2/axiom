/**
 * The Odds tab's market rows: every market with a posted price or a model
 * number, one row per outcome. Team outcomes sit on their team's side (away
 * left, home right); a tie or push is a centred row of its own. Pure, so the
 * vitest suites check exactly what the panel renders.
 */
import type { MarketOutcome, Prediction } from '../../types/prediction';
import { fmtOdds, fmtSignedPct } from './format';
import { hasPrediction } from './edge';

export type MarketKey = 'ml' | 'pl' | 'total' | 'reg' | 'p1' | 'p1-2w';

export interface SidesRow {
    kind: 'sides';
    key: MarketKey;
    label: string;
    /** Glossary id the label links to. */
    term?: string;
    /** Flank tags beside the label: the side spreads, or O / U. */
    tags?: [string, string];
    away?: MarketOutcome;
    home?: MarketOutcome;
    /** Derivative edge, INFO ONLY while the simulator's gate is closed. */
    gated: boolean;
}

export interface MiddleRow {
    kind: 'middle';
    key: `${MarketKey}-tie` | 'total-push';
    label: string;
    term?: string;
    outcome: MarketOutcome;
    gated: boolean;
}

export type MarketRow = SidesRow | MiddleRow;

function has(o: MarketOutcome | undefined): o is MarketOutcome {
    return !!o && (o.price != null || o.pct != null || o.fair != null || o.ev != null);
}

/** Posted price joined onto the simulator's outcome (either may be missing). */
function join(sim: MarketOutcome | undefined, price: number | null | undefined): MarketOutcome | undefined {
    const o: MarketOutcome = { ...(sim ?? {}) };
    if (price != null && o.price == null) o.price = price;
    return has(o) ? o : undefined;
}

/** "-1.5" → "−1.5", "1.5" → "+1.5" (the away side is the negative of the home spread). */
export function fmtSpread(v: string | number | null | undefined, negate = false): string | null {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/^\+/, '').replace('−', '-'));
    if (!Number.isFinite(n)) return null;
    const x = negate ? -n : n;
    const s = Math.abs(x).toFixed(1);
    return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

/** "6.0" stays "6", "6.5" stays "6.5". */
export function fmtLine(v: string | null | undefined): string | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
}

/** Model % to one decimal (no % sign: the column says so). */
export function fmtModelPct(v: number | undefined): string | null {
    return v == null || !Number.isFinite(v) ? null : v.toFixed(1);
}

/** EV fraction → signed % to one decimal ("+2.4%", "−12.1%", "0.0%"). */
export function fmtEv(ev: number | undefined): string | null {
    if (ev == null || !Number.isFinite(ev)) return null;
    const r = Math.round(ev * 1000) / 10;
    return r === 0 ? '0.0%' : fmtSignedPct(r);
}

export function evTone(ev: number | undefined): 'pos' | 'neg' | null {
    if (ev == null || !Number.isFinite(ev)) return null;
    const r = Math.round(ev * 1000);
    return r > 0 ? 'pos' : r < 0 ? 'neg' : null;
}

/** Fair American price, signed with a true minus ("+124", "−193"). */
export function fmtFair(v: string | undefined): string | null {
    return fmtOdds(v);
}

function sides(key: MarketKey, label: string, away: MarketOutcome | undefined, home: MarketOutcome | undefined, gated: boolean, extra?: Partial<SidesRow>): SidesRow | null {
    if (!has(away) && !has(home)) return null;
    return { kind: 'sides', key, label, away: has(away) ? away : undefined, home: has(home) ? home : undefined, gated, ...extra };
}

function middle(key: MiddleRow['key'], label: string, o: MarketOutcome | undefined, gated: boolean, term?: string): MiddleRow | null {
    return has(o) ? { kind: 'middle', key, label, outcome: o, gated, ...(term ? { term } : {}) } : null;
}

/**
 * Rows in display order: ML, PL, total (+ push), regulation 3-way (+ tie),
 * 1st-period 3-way (+ tie), 1st-period 2-way. Rows with nothing are omitted.
 */
export function marketRows(p: Prediction): MarketRow[] {
    const m = p.markets;
    // Derivative edges are info only until the simulator's own gate opens.
    const gated = !m?.evGated;
    const rows: (MarketRow | null)[] = [];

    const pred = hasPrediction(p);
    const ml = (s: 'away' | 'home'): MarketOutcome | undefined => {
        const d = p[s];
        const o: MarketOutcome = {};
        if (d.marketOdds != null) o.price = d.marketOdds;
        if (pred && d.winPct != null) o.pct = d.winPct;
        if (pred && d.fairOdds) o.fair = d.fairOdds;
        if (pred && d.ev != null) o.ev = d.ev;
        return o;
    };
    rows.push(sides('ml', 'ML', ml('away'), ml('home'), false));

    const homeSpread = m?.pl?.spread ?? p.home.pucklineSpread;
    const awaySpread = m?.pl?.spread != null ? fmtSpread(m.pl.spread, true) : fmtSpread(p.away.pucklineSpread);
    const plHome = fmtSpread(homeSpread);
    rows.push(
        sides('pl', 'PL', join(m?.pl?.away, p.away.puckline), join(m?.pl?.home, p.home.puckline), gated, plHome && awaySpread ? { tags: [awaySpread, plHome] } : {}),
    );

    const line = fmtLine(m?.total?.line ?? p.totalLine);
    // A posted price only belongs to the simulated line when the lines agree.
    const samePostedLine = m?.total?.line == null || p.totalLine == null || Number(m.total.line) === Number(p.totalLine);
    const over = join(m?.total?.over, samePostedLine ? p.totalOver : null);
    const under = join(m?.total?.under, samePostedLine ? p.totalUnder : null);
    // Over on the left, under on the right, as the label reads.
    const total = sides('total', line ? `O/U ${line}` : 'O/U', over, under, gated);
    rows.push(total);
    const push = m?.total?.pushPct;
    if (total && push != null && push > 0) rows.push(middle('total-push', 'Push', { pct: push }, gated, 'push'));

    const reg = sides('reg', 'Reg 3-way', join(m?.reg?.away, p.away.threeWay), join(m?.reg?.home, p.home.threeWay), gated, { term: 'reg-3way' });
    rows.push(reg);
    if (reg) rows.push(middle('reg-tie', 'Tie', join(m?.reg?.tie, p.threeWayTie), gated));

    const p1 = sides('p1', '1P 3-way', m?.p1?.away, m?.p1?.home, gated, { term: 'reg-3way' });
    rows.push(p1);
    if (p1) rows.push(middle('p1-tie', 'Tie', m?.p1?.tie, gated));

    rows.push(sides('p1-2w', '1P 2-way', join(m?.p1TwoWay?.away, p.away.firstPeriodMl), join(m?.p1TwoWay?.home, p.home.firstPeriodMl), gated, { term: 'p1-2way' }));

    return rows.filter((r): r is MarketRow => r !== null);
}

/** True when a shown derivative EV is info only (the simulator's gate is closed). */
export function hasInfoOnlyEv(rows: MarketRow[]): boolean {
    return rows.some(r => r.gated && (r.kind === 'sides' ? r.away?.ev != null || r.home?.ev != null : r.outcome.ev != null));
}
