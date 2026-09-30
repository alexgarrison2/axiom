import type { LedgerBet, LedgerBucket, LedgerData, LedgerSummary } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function bucket(v: unknown): LedgerBucket | null {
    if (!isObj(v)) return null;
    return {
        bucket: s(v.bucket) ?? '',
        n: n(v.n) ?? 0,
        record: s(v.record) ?? '0-0',
        unitsStaked: n(v.units_staked),
        unitsProfit: n(v.units_profit) ?? 0,
        roi: n(v.roi),
    };
}

function summary(v: unknown): LedgerSummary | null {
    if (!isObj(v)) return null;
    const ci = Array.isArray(v.roi_ci) && n(v.roi_ci[0]) != null && n(v.roi_ci[1]) != null ? ([v.roi_ci[0], v.roi_ci[1]] as [number, number]) : null;
    return {
        nBets: n(v.n_bets) ?? 0,
        nGraded: n(v.n_graded) ?? 0,
        nPending: n(v.n_pending) ?? 0,
        record: s(v.record) ?? '0-0',
        unitsStaked: n(v.units_staked) ?? 0,
        unitsProfit: n(v.units_profit) ?? 0,
        roi: n(v.roi),
        roiCi: ci,
        clvMean: n(v.clv_mean),
        clvN: n(v.clv_n) ?? 0,
        byEv: (Array.isArray(v.by_ev_bucket) ? v.by_ev_bucket : []).map(bucket).filter((b): b is LedgerBucket => !!b),
        byStake: (Array.isArray(v.by_stake) ? v.by_stake : []).map(bucket).filter((b): b is LedgerBucket => !!b),
    };
}

/** Summary-only view of bet_ledger.json (the page embeds this; bets load lazily). */
export function parseLedger(raw: unknown): LedgerData {
    const out: LedgerData = { unit: null, disclaimer: null, clvNote: null, source: null, gate: null, seasons: {}, generatedAt: null };
    if (!isObj(raw)) return out;
    out.unit = s(raw.unit);
    out.disclaimer = s(raw.disclaimer);
    out.clvNote = s(raw.clv_note);
    out.source = s(raw.source);
    out.generatedAt = s(raw.generated_at);
    if (isObj(raw.gate)) out.gate = { open: raw.gate.open === true, reasons: Array.isArray(raw.gate.reasons) ? raw.gate.reasons.filter((r): r is string => typeof r === 'string') : [] };
    if (isObj(raw.seasons)) {
        for (const [label, v] of Object.entries(raw.seasons)) {
            const sm = isObj(v) ? summary(v.summary) : null;
            if (sm) out.seasons[label] = sm;
        }
    }
    return out;
}

/** Every bet in bet_ledger.json (fetched by the browser from /data/bet_ledger.json). */
export function parseLedgerBets(raw: unknown): LedgerBet[] {
    if (!isObj(raw) || !isObj(raw.seasons)) return [];
    const out: LedgerBet[] = [];
    for (const [label, v] of Object.entries(raw.seasons)) {
        const bets = isObj(v) && Array.isArray(v.bets) ? v.bets : [];
        for (const b of bets) {
            if (!isObj(b)) continue;
            out.push({
                gameId: n(b.gameId) ?? 0,
                season: s(b.season) ?? label,
                type: s(b.gameType) ?? '02',
                date: s(b.date) ?? '',
                team: s(b.team) ?? '',
                opponent: s(b.opponent) ?? '',
                side: b.side === 'home' ? 'home' : 'away',
                stake: n(b.stake_units) ?? 0,
                price: n(b.price) ?? 0,
                evAtBet: n(b.ev_at_bet),
                evBucket: s(b.ev_bucket) ?? '',
                stakeBucket: s(b.stake_bucket) ?? '',
                modelProb: n(b.model_prob),
                result: s(b.result) ?? 'pending',
                profit: n(b.profit_units) ?? 0,
                final: s(b.final),
                decision: s(b.decision),
                clv: n(b.clv),
            });
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.gameId - b.gameId);
}

/** Running units total, one point per bet (oldest → newest). */
export function cumulativeUnits(bets: LedgerBet[]): { date: string; units: number }[] {
    let total = 0;
    return bets
        .filter(b => b.result === 'win' || b.result === 'loss' || b.result === 'push')
        .map(b => {
            total += b.profit;
            return { date: b.date, units: total };
        });
}

/** bet_ledger `final` is away-home ("2-4"); show it from the bet team's side ("4-2" for a home bet). */
export function teamFirstScore(final: string | null, side: 'home' | 'away'): string {
    if (!final) return '';
    const m = final.match(/^(\d+)-(\d+)$/);
    if (!m) return final;
    return side === 'home' ? `${m[2]}-${m[1]}` : final;
}

export function fmtAmerican(price: number): string {
    return price > 0 ? `+${Math.round(price)}` : `${Math.round(price)}`.replace('-', '−');
}
