/**
 * Tolerant reader for public/data/model_report.json (written by
 * pipeline/model_report.py). The page only needs a handful of numbers per
 * season, so this accepts a few reasonable shapes instead of hard-coding one:
 *
 *   { seasons: { "2025-26": { regular: { n, accuracy, brier, log_loss, baselines: { market: {...}, home_rate: {...} } } } } }
 *   { seasons: [ { season: "20252026", game_type: "regular", n, ... } ] }
 *   { "2025-26": { all: {...} } }
 */

export interface MetricRow {
    label: string;
    n?: number;
    accuracy?: number;
    brier?: number;
    logLoss?: number;
    isModel?: boolean;
    /** Model row: live picks from the previous site model (no model version recorded). */
    legacyN?: number;
    /** Market row: the model's log loss on the market's games. */
    modelLogLossSame?: number;
}

export interface SeasonSummary {
    season: string;
    gameType?: string;
    rows: MetricRow[];
    note?: string;
}

export interface WalkForwardRow {
    /** Held-out season, e.g. "2024-25". */
    season: string;
    n?: number;
    accuracy?: number;
    brier?: number;
    logLoss?: number;
    /** Log loss of always predicting the historical home win rate on the same games. */
    homeRateLogLoss?: number;
    /** Log loss of the previous (legacy) model on the same games. */
    legacyLogLoss?: number;
    /** Log loss of the de-vigged market on the same games (when the backtest had prices). */
    marketLogLoss?: number;
}

/** Out-of-sample games with real market prices (pipeline market backtest). */
export interface MarketBacktest {
    n?: number;
    first?: string;
    last?: string;
    modelLogLoss?: number;
    marketLogLoss?: number;
    prevLogLoss?: number;
}

export interface ModelInfo {
    name?: string;
    description?: string;
    trainingSeasons?: string[];
    features?: string[];
    generatedAt?: string;
    trainedAt?: string;
    gate?: { open?: boolean; reason?: string; reasons?: string[] };
    walkForward?: WalkForwardRow[];
    marketBacktest?: MarketBacktest;
    earlySeasonLogLoss?: number;
    notes?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (o: Obj, ...keys: string[]): number | undefined => {
    for (const k of keys) {
        const v = o[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (isObj(v) && typeof v.value === 'number') return v.value;
        if (isObj(v) && typeof v.mean === 'number') return v.mean;
    }
    return undefined;
};

/** "20252026" | "2025-26" | "2025-2026" | 2025 → "2025-26". */
export function normSeason(s: unknown): string | undefined {
    const t = String(s ?? '').trim();
    let m = t.match(/^(\d{4})(\d{4})$/);
    if (m) return `${m[1]}-${m[2].slice(2)}`;
    m = t.match(/^(\d{4})-(\d{2}|\d{4})$/);
    if (m) return `${m[1]}-${m[2].slice(-2)}`;
    m = t.match(/^(\d{4})$/);
    if (m) return `${m[1]}-${String(Number(m[1]) + 1).slice(2)}`;
    return undefined;
}

const BASELINE_LABELS: Record<string, string> = {
    market: 'Betting market (de-vigged)',
    market_favorite: 'Betting market (de-vigged)',
    vegas: 'Betting market (de-vigged)',
    home_rate: 'Always home-rate',
    home: 'Always home-rate',
    constant: 'Always home-rate',
    coin_flip: 'Coin flip (50%)',
    coinflip: 'Coin flip (50%)',
};

function metricRow(label: string, o: Obj, isModel = false): MetricRow {
    const row: MetricRow = {
        label,
        isModel,
        n: num(o, 'n', 'games', 'n_games', 'count'),
        accuracy: num(o, 'accuracy', 'acc', 'hit_rate'),
        brier: num(o, 'brier', 'brier_score'),
        logLoss: num(o, 'log_loss', 'logloss', 'logLoss'),
    };
    const legacyN = num(o, 'n_legacy');
    if (isModel && legacyN != null) row.legacyN = legacyN;
    const same = num(o, 'model_log_loss_same_games');
    if (!isModel && same != null) row.modelLogLossSame = same;
    return row;
}

function summarize(season: string, block: Obj, gameType?: string): SeasonSummary | null {
    const model = isObj(block.model) ? block.model : block;
    const rows: MetricRow[] = [metricRow('Pony xG model', model, true)];
    const baselines = isObj(block.baselines) ? block.baselines : isObj(model.baselines) ? model.baselines : null;
    if (baselines) {
        for (const [k, v] of Object.entries(baselines)) {
            if (isObj(v)) rows.push(metricRow(BASELINE_LABELS[k] ?? k.replace(/_/g, ' '), v));
        }
    }
    if (rows[0].brier == null && rows[0].logLoss == null && rows[0].accuracy == null) return null;
    const note = typeof block.note === 'string' ? block.note : typeof block.sample === 'string' ? block.sample : undefined;
    return { season, gameType, rows, note };
}

const GAME_TYPE_PREF = ['regular', 'reg', '02', '2', 'all', 'overall', 'combined', 'playoffs', 'po', '03', '3'];

function pickGameType(block: Obj): [Obj, string | undefined] {
    for (const k of GAME_TYPE_PREF) {
        const v = block[k];
        if (isObj(v)) return [v, k];
    }
    for (const k of ['game_types', 'by_game_type', 'types']) {
        const inner = block[k];
        if (isObj(inner)) return pickGameType(inner);
    }
    return [block, undefined];
}

export function parseReport(raw: unknown): { model: ModelInfo; seasons: SeasonSummary[] } {
    const model: ModelInfo = {};
    const seasons: SeasonSummary[] = [];
    if (!isObj(raw)) return { model, seasons };

    const m = isObj(raw.model) ? raw.model : {};
    const str = (...vals: unknown[]) => vals.find((v): v is string => typeof v === 'string' && v.trim() !== '');
    model.name = str(m.name, raw.model_name, m.version);
    model.description = str(m.description, typeof m.type === 'string' ? m.type.replace(/_/g, ' ') : undefined);
    const ts = m.training_seasons ?? raw.training_seasons;
    if (Array.isArray(ts)) model.trainingSeasons = ts.map(s => normSeason(s) ?? String(s));
    if (Array.isArray(m.features)) model.features = m.features.map(String);
    model.generatedAt = str(raw.generated_at);
    model.trainedAt = str(m.trained_at);
    model.notes = str(raw.notes);
    if (typeof m.early_season_log_loss === 'number') model.earlySeasonLogLoss = m.early_season_log_loss;
    if (Array.isArray(m.walk_forward)) {
        model.walkForward = m.walk_forward
            .filter(isObj)
            .map(w => ({
                season: normSeason(w.test_season ?? w.season) ?? String(w.test_season ?? w.season ?? ''),
                n: num(w, 'n', 'games'),
                accuracy: num(w, 'accuracy'),
                brier: num(w, 'brier'),
                logLoss: num(w, 'log_loss', 'logloss'),
                homeRateLogLoss: num(w, 'home_rate_log_loss'),
                legacyLogLoss: num(w, 'legacy_xgb_log_loss', 'legacy_log_loss', 'current_log_loss'),
                marketLogLoss: num(w, 'market_log_loss'),
            }))
            .filter(w => w.season && w.logLoss != null);
    }
    const bt = isObj(raw.market_backtest) ? raw.market_backtest : null;
    if (bt && isObj(bt.log_loss)) {
        const ll = bt.log_loss;
        model.marketBacktest = {
            n: num(bt, 'n_games', 'n'),
            first: str(bt.first_game),
            last: str(bt.last_game),
            modelLogLoss: num(ll, 'new_model'),
            marketLogLoss: num(ll, 'market_power_devig', 'market'),
            prevLogLoss: num(ll, 'site_model_as_shown'),
        };
    }
    const gate = isObj(raw.gate) ? raw.gate : isObj(raw.gate_status) ? raw.gate_status : null;
    if (gate) {
        model.gate = {
            open: typeof gate.open === 'boolean' ? gate.open : undefined,
            reason: str(gate.summary, gate.reason, gate.explanation),
            reasons: Array.isArray(gate.reasons) ? gate.reasons.filter((r): r is string => typeof r === 'string') : undefined,
        };
    }

    const container = raw.seasons ?? raw.by_season ?? raw;
    if (Array.isArray(container)) {
        for (const entry of container) {
            if (!isObj(entry)) continue;
            const season = normSeason(entry.season ?? entry.season_id);
            if (!season) continue;
            const gt = typeof entry.game_type === 'string' ? entry.game_type : undefined;
            if (gt && !['regular', 'reg', '02', '2', 'all', 'overall'].includes(gt.toLowerCase())) continue;
            const s = summarize(season, entry, gt);
            if (s && !seasons.some(x => x.season === season)) seasons.push(s);
        }
    } else if (isObj(container)) {
        for (const [k, v] of Object.entries(container)) {
            const season = normSeason(k);
            if (!season || !isObj(v)) continue;
            const [block, gt] = pickGameType(v);
            const s = summarize(season, block, gt);
            if (s) seasons.push(s);
        }
    }
    seasons.sort((a, b) => b.season.localeCompare(a.season));
    return { model, seasons };
}
