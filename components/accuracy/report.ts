import { isCorrect, type ExcludedGame, type GradedGame, type SeasonTally } from './types';
/**
 * Typed, trimmed view of public/data/model_report.json for /accuracy, plus an
 * n-weighted "All seasons" aggregate. Pure: runs on server, client and tests.
 */

export type GameTypeKey = 'all' | 'regular' | 'playoffs';

export interface Baseline {
    n: number;
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
    /** Model on the same games (market baseline only). */
    modelLogLossSame?: number | null;
    modelAccuracySame?: number | null;
    note?: string | null;
}

export interface ReliabilityBin {
    lo: number;
    hi: number;
    n: number;
    meanPred: number | null;
    actual: number | null;
}

export interface Tier {
    tier: string;
    n: number;
    correct: number;
    accuracy: number | null;
    ci: [number, number] | null;
    meanConfidence: number | null;
}

export interface RollingPoint {
    i: number;
    date: string;
    model: number;
    market: number;
}

export interface CallRow {
    gameId: number;
    date: string;
    homeTeam: string;
    awayTeam: string;
    pick: string;
    confidence: number;
    homeScore: number;
    awayScore: number;
    decision: string;
    correct: boolean;
}

export interface ReportBlock {
    n: number;
    nRetro: number;
    accuracy: number | null;
    accuracyCi: [number, number] | null;
    correct: number;
    brier: number | null;
    logLoss: number | null;
    firstDate: string | null;
    lastDate: string | null;
    homeRate: Baseline & { rate: number | null; source: string | null };
    market: Baseline;
    reliability: ReliabilityBin[];
    tiers: Tier[];
    rolling: RollingPoint[];
    bestCalls: CallRow[];
    worstMisses: CallRow[];
}

export interface GateInfo {
    open: boolean;
    summary: string | null;
    reasons: string[];
}

export interface AccuracyReport {
    generatedAt: string | null;
    currentSeason: string | null;
    notes: string | null;
    /** season label ("2025-26") → game type → block */
    seasons: Record<string, Partial<Record<GameTypeKey, ReportBlock>>>;
    gate: GateInfo | null;
    modelName: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && n(v[0]) != null && n(v[1]) != null ? [v[0] as number, v[1] as number] : null);

function parseBaseline(v: unknown): Baseline {
    const o = isObj(v) ? v : {};
    return {
        n: n(o.n) ?? 0,
        accuracy: n(o.accuracy),
        brier: n(o.brier),
        logLoss: n(o.log_loss),
        modelLogLossSame: n(o.model_log_loss_same_games),
        modelAccuracySame: n(o.model_accuracy_same_games),
        note: s(o.source),
    };
}

function parseCall(v: unknown): CallRow | null {
    if (!isObj(v)) return null;
    return {
        gameId: n(v.gameId) ?? 0,
        date: s(v.date) ?? '',
        homeTeam: s(v.homeTeam) ?? '',
        awayTeam: s(v.awayTeam) ?? '',
        pick: s(v.pick) ?? '',
        confidence: n(v.confidence) ?? 0,
        homeScore: n(v.homeScore) ?? 0,
        awayScore: n(v.awayScore) ?? 0,
        decision: s(v.decision) ?? 'REG',
        correct: v.correct === true,
    };
}

export function parseBlock(v: unknown): ReportBlock | null {
    if (!isObj(v)) return null;
    const hr = isObj(v.baselines) ? (v.baselines as Obj).home_rate : null;
    const mk = isObj(v.baselines) ? (v.baselines as Obj).market : null;
    return {
        n: n(v.n) ?? 0,
        nRetro: n(v.n_retro_excluded) ?? 0,
        accuracy: n(v.accuracy),
        accuracyCi: pair(v.accuracy_ci),
        correct: n(v.correct) ?? 0,
        brier: n(v.brier),
        logLoss: n(v.log_loss),
        firstDate: s(v.first_date),
        lastDate: s(v.last_date),
        homeRate: { ...parseBaseline(hr), rate: isObj(hr) ? n(hr.rate) : null, source: isObj(hr) ? s(hr.source) : null },
        market: parseBaseline(mk),
        reliability: (Array.isArray(v.reliability) ? v.reliability : []).filter(isObj).map(b => ({
            lo: n(b.lo) ?? 0,
            hi: n(b.hi) ?? 0,
            n: n(b.n) ?? 0,
            meanPred: n(b.mean_pred),
            actual: n(b.actual),
        })),
        tiers: (Array.isArray(v.tiers) ? v.tiers : []).filter(isObj).map(t => ({
            tier: s(t.tier) ?? '',
            n: n(t.n) ?? 0,
            correct: n(t.correct) ?? 0,
            accuracy: n(t.accuracy),
            ci: pair(t.accuracy_ci),
            meanConfidence: n(t.mean_confidence),
        })),
        rolling: (Array.isArray(v.rolling) ? v.rolling : [])
            .filter(isObj)
            .map(r => ({ i: n(r.i) ?? 0, date: s(r.date) ?? '', model: n(r.model) ?? NaN, market: n(r.market) ?? NaN }))
            .filter(r => Number.isFinite(r.model) && Number.isFinite(r.market)),
        bestCalls: (Array.isArray(v.best_calls) ? v.best_calls : []).map(parseCall).filter((c): c is CallRow => !!c),
        worstMisses: (Array.isArray(v.worst_misses) ? v.worst_misses : []).map(parseCall).filter((c): c is CallRow => !!c),
    };
}

export function parseAccuracyReport(raw: unknown): AccuracyReport {
    const out: AccuracyReport = { generatedAt: null, currentSeason: null, notes: null, seasons: {}, gate: null, modelName: null };
    if (!isObj(raw)) return out;
    out.generatedAt = s(raw.generated_at);
    out.currentSeason = s(raw.current_season);
    out.notes = s(raw.notes);
    if (isObj(raw.model)) out.modelName = s(raw.model.name);
    if (isObj(raw.seasons)) {
        for (const [label, v] of Object.entries(raw.seasons)) {
            if (!isObj(v)) continue;
            const blocks: Partial<Record<GameTypeKey, ReportBlock>> = {};
            for (const k of ['all', 'regular', 'playoffs'] as GameTypeKey[]) {
                const b = parseBlock(v[k]);
                if (b) blocks[k] = b;
            }
            out.seasons[label] = blocks;
        }
    }
    if (isObj(raw.gate)) {
        const g = raw.gate;
        out.gate = {
            open: g.open === true,
            summary: s(g.summary),
            reasons: Array.isArray(g.reasons) ? g.reasons.filter((r): r is string => typeof r === 'string') : s(g.reason) ? [g.reason as string] : [],
        };
    }
    return out;
}

/* ── Aggregation across seasons ──────────────────────────────────────── */

function wavg(items: { w: number; v: number | null }[]): number | null {
    const ok = items.filter(i => i.v != null && i.w > 0);
    const w = ok.reduce((a, i) => a + i.w, 0);
    return w ? ok.reduce((a, i) => a + i.w * (i.v as number), 0) / w : null;
}

function wilson(k: number, total: number): [number, number] | null {
    if (!total) return null;
    const z = 1.96;
    const p = k / total;
    const d = 1 + (z * z) / total;
    const c = p + (z * z) / (2 * total);
    const m = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
    return [(c - m) / d, (c + m) / d];
}

function combineBaseline(list: Baseline[]): Baseline {
    return {
        n: list.reduce((a, b) => a + b.n, 0),
        accuracy: wavg(list.map(b => ({ w: b.n, v: b.accuracy }))),
        brier: wavg(list.map(b => ({ w: b.n, v: b.brier }))),
        logLoss: wavg(list.map(b => ({ w: b.n, v: b.logLoss }))),
        modelLogLossSame: wavg(list.map(b => ({ w: b.n, v: b.modelLogLossSame ?? null }))),
        modelAccuracySame: wavg(list.map(b => ({ w: b.n, v: b.modelAccuracySame ?? null }))),
    };
}

/** n-weighted combination of several seasons' blocks (same game type). */
export function combineBlocks(blocks: ReportBlock[]): ReportBlock | null {
    const bs = blocks.filter(Boolean);
    if (!bs.length) return null;
    if (bs.length === 1) return bs[0];
    const total = bs.reduce((a, b) => a + b.n, 0);
    const correct = bs.reduce((a, b) => a + b.correct, 0);
    const dates = bs.flatMap(b => [b.firstDate, b.lastDate]).filter((d): d is string => !!d).sort();
    const bins = bs[0].reliability.length ? bs[0].reliability : bs.find(b => b.reliability.length)?.reliability ?? [];
    const tierNames = [...new Set(bs.flatMap(b => b.tiers.map(t => t.tier)))];
    return {
        n: total,
        nRetro: bs.reduce((a, b) => a + b.nRetro, 0),
        accuracy: total ? correct / total : null,
        accuracyCi: wilson(correct, total),
        correct,
        brier: wavg(bs.map(b => ({ w: b.n, v: b.brier }))),
        logLoss: wavg(bs.map(b => ({ w: b.n, v: b.logLoss }))),
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
        homeRate: { ...combineBaseline(bs.map(b => b.homeRate)), rate: wavg(bs.map(b => ({ w: b.n, v: b.homeRate.rate }))), source: 'per-season home win rate' },
        market: combineBaseline(bs.map(b => b.market)),
        reliability: bins.map((bin, i) => {
            const parts = bs.map(b => b.reliability[i]).filter(Boolean);
            const nn = parts.reduce((a, p) => a + p.n, 0);
            return {
                lo: bin.lo,
                hi: bin.hi,
                n: nn,
                meanPred: wavg(parts.map(p => ({ w: p.n, v: p.meanPred }))),
                actual: wavg(parts.map(p => ({ w: p.n, v: p.actual }))),
            };
        }),
        tiers: tierNames.map(name => {
            const parts = bs.flatMap(b => b.tiers.filter(t => t.tier === name));
            const nn = parts.reduce((a, t) => a + t.n, 0);
            const c = parts.reduce((a, t) => a + t.correct, 0);
            return { tier: name, n: nn, correct: c, accuracy: nn ? c / nn : null, ci: wilson(c, nn), meanConfidence: wavg(parts.map(t => ({ w: t.n, v: t.meanConfidence }))) };
        }),
        rolling: bs
            .flatMap(b => b.rolling)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((r, i) => ({ ...r, i })),
        bestCalls: bs
            .flatMap(b => b.bestCalls)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5),
        worstMisses: bs
            .flatMap(b => b.worstMisses)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5),
    };
}

/** "20262027" / 2026 → "2026-27". */
export function seasonLabelOf(seasonId: string): string {
    return `${seasonId.slice(0, 4)}-${seasonId.slice(6, 8)}`;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ll = (p: number, won: boolean) => -Math.log(Math.min(1 - 1e-6, Math.max(1e-6, won ? p : 1 - p)));

const typeMatch = (g: { type?: string }, type: GameTypeKey) => type === 'all' || (type === 'regular' ? g.type !== '03' : g.type === '03');

/** The season record straight from the graded list (live picks only), optionally for one game type. */
export function tallySeason(games: GradedGame[], season: string, excluded: ExcludedGame[] = [], type: GameTypeKey = 'all'): SeasonTally {
    const rows = games.filter(g => g.season === season && !g.retro && typeMatch(g, type));
    const withMarket = rows.filter(g => g.marketProb != null);
    return {
        n: rows.length,
        correct: rows.filter(isCorrect).length,
        brier: mean(rows.map(g => g.brier).filter(Number.isFinite)),
        logLoss: mean(rows.map(g => g.logLoss).filter(Number.isFinite)),
        marketN: withMarket.length,
        marketLogLoss: mean(withMarket.map(g => ll(g.marketProb! / 100, g.homeScore > g.awayScore))),
        modelLogLossSame: mean(withMarket.map(g => ll(g.homeProb / 100, g.homeScore > g.awayScore))),
        legacyN: rows.filter(g => g.legacy).length,
        placeholderN: rows.filter(g => g.placeholderOdds).length,
        excluded: excluded.filter(e => typeMatch(e, type)),
    };
}

/** Tallies for every game type, keyed like the report blocks. */
export function tallyByType(games: GradedGame[], season: string, excluded: ExcludedGame[] = []): Record<GameTypeKey, SeasonTally> {
    return {
        all: tallySeason(games, season, excluded, 'all'),
        regular: tallySeason(games, season, excluded, 'regular'),
        playoffs: tallySeason(games, season, excluded, 'playoffs'),
    };
}

/**
 * True when model_report.json lags the graded list (it is rebuilt nightly,
 * the graded list every refresh). The page then shows the tally instead of
 * the report, so the two can never contradict each other.
 */
export function reportLags(reportN: number | null | undefined, tally: SeasonTally | null | undefined): boolean {
    return !!tally && tally.n > (reportN ?? 0);
}

const REASONS: Record<string, string> = {
    snapshot_after_start: 'No pregame snapshot before puck drop',
    no_snapshot: 'No pregame snapshot before puck drop',
};

export const seasonOfGameId = (id: number): string => {
    const y = Math.floor(id / 1_000_000);
    return y > 1900 ? `${y}-${String(y + 1).slice(2)}` : '';
};

/**
 * Finals left out of grading for a season. Explicit exclusion records in
 * prediction_history ({gameId, excluded}) win; any other final in
 * gamestats.csv (home rows) with no graded row is listed as having no
 * pregame snapshot. Pure so it can be tested without the data files.
 */
export function deriveExcluded(
    history: unknown,
    gamestatsCsv: string,
    season: string,
    graded: GradedGame[],
    teamTri: (name: string) => string | null,
): ExcludedGame[] {
    const out = new Map<number, ExcludedGame>();
    const gradedIds = new Set(graded.map(g => g.id));
    const typeOf = (id: number) => String(id).slice(4, 6);
    if (Array.isArray(history)) {
        for (const r of history as Obj[]) {
            if (!isObj(r) || !r.excluded) continue;
            const id = n(r.gameId) ?? 0;
            if (!id || gradedIds.has(id)) continue;
            if ((s(r.season) ?? seasonOfGameId(id)) !== season) continue;
            const home = String(r.homeTeam ?? '');
            const away = String(r.awayTeam ?? '');
            out.set(id, {
                id,
                date: String(r.date ?? '').slice(0, 10),
                home: teamTri(home) ?? home,
                away: teamTri(away) ?? away,
                reason: REASONS[String(r.excluded)] ?? String(r.excluded).replace(/_/g, ' '),
                type: typeOf(id),
            });
        }
    }
    const lines = gamestatsCsv.split(/\r?\n/);
    const head = (lines[0] ?? '').split(',');
    const [iId, iDate, iTeam, iOpp, iHA] = ['game_id', 'game_date', 'team', 'opponent', 'home_away'].map(k => head.indexOf(k));
    if (iId >= 0 && iTeam >= 0 && iOpp >= 0 && iHA >= 0) {
        for (const line of lines.slice(1)) {
            const c = line.split(',');
            const id = Number(c[iId]);
            if (!id || c[iHA] !== 'Home' || gradedIds.has(id) || out.has(id) || seasonOfGameId(id) !== season) continue;
            const type = typeOf(id);
            if (type !== '02' && type !== '03') continue;
            const home = teamTri(c[iTeam]);
            const away = teamTri(c[iOpp]);
            if (!home || !away) continue;
            out.set(id, { id, date: (c[iDate] ?? '').slice(0, 10), home, away, reason: REASONS.no_snapshot, type });
        }
    }
    return [...out.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

