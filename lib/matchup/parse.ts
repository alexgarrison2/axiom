/**
 * predictions_detailed.csv row (contract v2) → Prediction.
 *
 * Pure and client-safe: the server loader (utils/data.ts) and the vitest
 * suites that load pipeline/fixtures/*.csv both go through here, so the card
 * is tested against exactly what the page renders.
 */
import { TEAM_NAMES } from '../../components/ui/team-color';
import type { GameState, MarketOutcome, Prediction, PredictionStatus, RecentGame, Side, SideData, SimMarkets, TeamRef, ThreeWayMarket, TvBroadcast, TwoWayMarket, WpFactor } from '../../types/prediction';

export type RawRow = Record<string, string | undefined>;

const GAME_STATES: GameState[] = ['FUT', 'PRE', 'LIVE', 'CRIT', 'FINAL', 'OFF'];
const STATUSES: PredictionStatus[] = ['pregame', 'frozen', 'no_pregame_prediction', 'no_model'];

export function str(v: string | undefined | null): string | null {
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' || t === 'nan' || t === 'NaN' || t === 'None' ? null : t;
}

export function num(v: string | undefined | null): number | null {
    const s = str(v);
    if (s == null) return null;
    const n = Number(s.replace(/^\+/, ''));
    return Number.isFinite(n) ? n : null;
}

export function int(v: string | undefined | null): number | null {
    const n = num(v);
    return n == null ? null : Math.round(n);
}

/** Fair American line of a win % (0-100), as the pipeline writes it ("+157", "-106", "+100"). */
export function fairLine(pct: number | null): string | null {
    if (pct == null || !(pct > 0 && pct < 100)) return null;
    const p = pct / 100;
    if (Math.abs(p - 0.5) < 1e-12) return '+100';
    const o = p > 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
    const r = Math.round(o);
    return r > 0 ? `+${r}` : String(r);
}

export function bool(v: string | undefined | null): boolean {
    return str(v)?.toLowerCase() === 'true';
}

export function json<T>(v: string | undefined | null, fallback: T): T {
    const s = str(v);
    if (!s) return fallback;
    try {
        return JSON.parse(s.replace(/\bNaN\b/g, 'null')) as T;
    } catch {
        return fallback;
    }
}

export function teamRef(tri: string, commonName?: string | null): TeamRef {
    const t = TEAM_NAMES[tri];
    return {
        triCode: tri,
        commonName: t?.short ?? commonName ?? tri,
        name: t?.name ?? commonName ?? tri,
        logoUrl: `/logos/${tri}.svg`,
    };
}

function parseVsOpp(v: string | undefined): SideData['vsOpp'] {
    const o = json<Record<string, unknown> | null>(v, null);
    if (!o || typeof o !== 'object') return null;
    const sv = Number(o.sv);
    const gaa = Number(o.gaa);
    if (!Number.isFinite(sv) || !Number.isFinite(gaa) || typeof o.record !== 'string') return null;
    return { label: String(o.label ?? ''), record: o.record, sv, gaa };
}

function side(row: RawRow, s: Side, team: TeamRef): SideData {
    const k = (name: string) => row[`${s}_${name}`];
    const news = json<{ category?: string }[]>(k('news'), []);
    return {
        team,
        modelWinPct: num(k('model_win_pct')),
        winPct: num(k('win_pct')),
        // "Fair" sits next to the published % (Our forecast), so it is the
        // fair line of that blended %: *_blend_odds (fix1-G1). *_model_odds is
        // the model-only line. Rows without blend_odds derive it from win_pct.
        fairOdds: str(k('blend_odds')) ?? fairLine(num(k('win_pct'))),
        marketOdds: int(k('vegas_odds')),
        marketWinPct: num(k('vegas_win_pct')),
        ev: num(k('ev')),
        xg: num(k('xg')),
        gp: int(k('gp')) ?? 0,
        l7: str(k('l7')),
        l7N: int(k('l7_n')) ?? 0,
        l7Label: str(k('l7_label')),
        h2hRecord: str(k('h2h_record')),
        h2hPrev: str(k('h2h_prev')),
        locRecord: str(k('loc_record')),
        locGp: int(k('loc_gp')) ?? 0,
        ppRank: int(k('pp_rank')),
        pkRank: int(k('pk_rank')),
        ppPct: num(k('pp_pct')),
        pkPct: num(k('pk_pct')),
        ppOpps: int(k('pp_opps')),
        pkOpps: int(k('pk_opps')),
        ppRankPrev: int(k('pp_rank_prev')),
        pkRankPrev: int(k('pk_rank_prev')),
        restDays: int(k('rest_days')),
        isB2b: bool(k('is_b2b')),
        gamesInLast4: int(k('games_in_last_4')),
        roadTripGameN: int(k('road_trip_game_n')),
        goalie: str(k('goalie_confirmed')) ?? str(k('starter'))?.replace(/\s*\(.*\)\s*$/, '') ?? null,
        goalieStatus: str(k('goalie_status')),
        goalieStatusSource: str(k('goalie_status_source')),
        goalieStatusAt: str(k('goalie_status_at')),
        goalieCur: str(k('goalie_stats_cur')),
        goaliePrev: str(k('goalie_stats_prev')),
        goalieCurGp: int(k('goalie_cur_gp')),
        goaliePo: str(row.game_type) === '03' ? str(k('goalie_po')) : null,
        gsax: num(k('gsax')),
        gsaxPct: num(k('gsax_pct')),
        vsOpp: parseVsOpp(k('starter_vs_opp')),
        lineupScore: num(k('lineup_score')),
        lineupMatched: int(k('lineup_matched')),
        puckline: int(k('puckline')),
        pucklineSpread: str(k('puckline_spread')),
        firstPeriodMl: int(k('1p_ml')),
        threeWay: int(k('three_way')),
        record: null,
        hasNews: Array.isArray(news) && news.some(n => n && n.category !== 'Goalie Start'),
    };
}

/**
 * The broadcasters for one upcoming_games.json game: its curated `tvDisplay`
 * list, else (older files) the single US national `tvNetwork` string.
 */
export function parseTv(game: { tvDisplay?: unknown; tvNetwork?: unknown } | null | undefined): TvBroadcast[] {
    if (!game) return [];
    if (Array.isArray(game.tvDisplay)) {
        const out: TvBroadcast[] = [];
        for (const b of game.tvDisplay as Record<string, unknown>[]) {
            const network = typeof b?.network === 'string' ? b.network.trim() : '';
            if (!network) continue;
            const market = b.market === 'H' || b.market === 'A' ? b.market : 'N';
            const team = typeof b.team === 'string' && b.team ? b.team : null;
            out.push({ network, market, team: market === 'N' ? null : team, country: b.country === 'CA' ? 'CA' : 'US' });
        }
        return out;
    }
    const legacy = typeof game.tvNetwork === 'string' ? game.tvNetwork.trim() : '';
    return legacy ? [{ network: legacy, market: 'N', team: null, country: 'US' }] : [];
}

export function parseRow(row: RawRow, tv?: TvBroadcast[] | string | null): Prediction | null {
    const homeTri = str(row.home_abbrev);
    const awayTri = str(row.away_abbrev);
    const id = str(row.nhl_game_id);
    const date = str(row.game_date);
    if (!homeTri || !awayTri || !id || !date) return null;
    const state = (str(row.game_state) ?? 'FUT') as GameState;
    const status = (str(row.prediction_status) ?? 'pregame') as PredictionStatus;
    const bs = str(row.bet_side);
    const breakdown = json<WpFactor[]>(row.home_wp_breakdown, []).filter(
        f => f && typeof f.factor === 'string' && Number.isFinite(Number(f.wp_delta_pts)),
    ).map(f => ({ factor: String(f.factor), label: typeof f.label === 'string' ? f.label : undefined, wp_delta_pts: Number(f.wp_delta_pts) }));

    const tvBroadcasts: TvBroadcast[] = typeof tv === 'string' ? parseTv({ tvNetwork: tv }) : (tv ?? []);

    return {
        id,
        legacyId: str(row.game_id) ?? id,
        seasonId: str(row.season_id) ?? '',
        gameType: str(row.game_type) ?? '02',
        date,
        startTimeUtc: str(row.start_time_utc) ?? `${date}T23:00:00Z`,
        gameState: GAME_STATES.includes(state) ? state : 'FUT',
        status: STATUSES.includes(status) ? status : 'pregame',
        contextSeason: str(row.context_season),
        predictedAt: str(row.predicted_at),
        modelVersion: str(row.model_version),
        preseasonPrior: bool(row.preseason_prior),
        blendWeight: num(row.blend_weight),
        evGated: bool(row.ev_gated),
        betSide: bs === 'home' || bs === 'away' ? bs : null,
        units: num(row.units),
        gateReason: str(row.gate_reason),
        marketSource: str(row.market_source),
        marketFetchedAt: str(row.market_fetched_at),
        expectedTotal: num(row.expected_total),
        breakdown,
        pickSummary: str(row.pick_summary),
        confidenceGrade: str(row.confidence_grade),
        confidenceNote: str(row.confidence_note),
        h2hGp: int(row.h2h_gp) ?? 0,
        h2hPrevGp: int(row.h2h_prev_gp),
        totalLine: str(row.total_line),
        totalOver: int(row.total_over),
        totalUnder: int(row.total_under),
        threeWayTie: int(row.three_way_tie),
        tvNetwork: tvBroadcasts[0]?.network ?? null,
        tvBroadcasts,
        home: side(row, 'home', teamRef(homeTri, str(row.home_team))),
        away: side(row, 'away', teamRef(awayTri, str(row.away_team))),
        markets: parseMarkets(row),
    };
}

/** num() / str() / int() with absent → undefined (the markets' convention). */
const u = <T>(v: T | null): T | undefined => (v == null ? undefined : v);

/** One market outcome, or undefined when every cell is empty. */
function outcome(o: { price?: string; pct?: string; fair?: string; ev?: string }): MarketOutcome | undefined {
    const out: MarketOutcome = {};
    const price = int(o.price);
    const pct = num(o.pct);
    const fair = str(o.fair);
    const ev = num(o.ev);
    if (price != null) out.price = price;
    if (pct != null) out.pct = pct;
    if (fair != null) out.fair = fair;
    if (ev != null) out.ev = ev;
    return Object.keys(out).length ? out : undefined;
}

/** Drop undefined members; undefined when nothing is left. */
function some<T extends object>(o: T): T | undefined {
    const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
    return Object.keys(kept).length ? kept : undefined;
}

const SIM_STATUSES = ['sim', 'poisson_fallback'] as const;

/**
 * The game simulator's markets (contract v2.2). Tolerant of their absence:
 * older SiteHistory rows and fixtures without the columns give undefined,
 * and an empty or non-numeric cell gives an undefined field, never NaN.
 */
export function parseMarkets(row: RawRow): SimMarkets | undefined {
    const st = str(row.sim_status);
    const status = SIM_STATUSES.find(s => s === st);
    const two = (pre: string): TwoWayMarket | undefined =>
        some({
            away: outcome({ pct: row[`away_${pre}_pct`], fair: row[`away_${pre}_fair`], ev: row[`away_${pre}_ev`] }),
            home: outcome({ pct: row[`home_${pre}_pct`], fair: row[`home_${pre}_fair`], ev: row[`home_${pre}_ev`] }),
        });
    const p1 = some<ThreeWayMarket>({
        away: outcome({ price: row.away_1p_three_way, pct: row.away_1p_pct, fair: row.away_1p_fair, ev: row.away_1p3_ev }),
        home: outcome({ price: row.home_1p_three_way, pct: row.home_1p_pct, fair: row.home_1p_fair, ev: row.home_1p3_ev }),
        tie: outcome({ price: row.p1_three_way_tie, pct: row.p1_tie_pct, fair: row.p1_tie_fair, ev: row.p1_tie_ev }),
    });
    const reg = some<ThreeWayMarket>({
        ...two('reg'),
        tie: outcome({ pct: row.reg_tie_pct, fair: row.reg_tie_fair, ev: row.reg_tie_ev }),
    });
    const pl = two('pl');
    const total = some({
        over: outcome({ pct: row.over_pct, fair: row.over_fair, ev: row.over_ev }),
        under: outcome({ pct: row.under_pct, fair: row.under_fair, ev: row.under_ev }),
        pushPct: u(num(row.total_push_pct)),
    });
    const p1TwoWay = some<TwoWayMarket>({
        away: outcome({ pct: row.away_1p_2w_pct, fair: row.away_1p_2w_fair, ev: row.away_1p_ev }),
        home: outcome({ pct: row.home_1p_2w_pct, fair: row.home_1p_2w_fair, ev: row.home_1p_ev }),
    });
    const markets = some<Omit<SimMarkets, 'status' | 'evGated' | 'gateReason'>>({
        reg,
        pl: pl ? { ...pl, ...some({ spread: u(str(row.sim_pl_spread)) }) } : undefined,
        total: total ? { ...total, ...some({ line: u(str(row.sim_total_line)) }) } : undefined,
        p1,
        p1TwoWay,
    });
    if (!status && !markets) return undefined;
    return {
        ...(status ? { status } : {}),
        evGated: bool(row.sim_ev_gated),
        ...some({ gateReason: u(str(row.sim_gate_reason)) }),
        ...markets,
    };
}

/** Recent games (side_l7_games), newest first as written by the pipeline. */
export function parseRecent(v: string | undefined): RecentGame[] {
    const games = json<RecentGame[]>(v, []);
    return Array.isArray(games) ? games.filter(g => g && typeof g.opponent === 'string') : [];
}

/**
 * Season W-L-OTL derived from the pipeline's own game list when the team has
 * played no more games than the list holds (early season), else null.
 */
export function recordFromRecent(gp: number, games: RecentGame[]): string | null {
    if (gp <= 0 || games.length < gp) return null;
    let w = 0, l = 0, o = 0;
    for (const g of games.slice(0, gp)) {
        if (g.gameType && g.gameType !== '02') return null;
        if (g.result.startsWith('W')) w++;
        else if (g.result === 'O' || g.result === 'L-OT') o++;
        else l++;
    }
    return `${w}-${l}-${o}`;
}

const KNOWN_FACTORS = new Set(['home_ice', 'strength_5v5', 'special_teams', 'goaltending', 'rest', 'lineup', 'lineup_goalie', 'market']);

/**
 * Shrink a Prediction for the page payload: drop null / false / empty
 * fields (the client reads them as absent) and the labels of factors the
 * waterfall already names. Keeps the home HTML inside its 40KB gzip budget
 * on a full two-day slate.
 */
export function compactForClient(p: Prediction): Prediction {
    const slim = {
        ...p,
        breakdown: p.breakdown.map(f => (KNOWN_FACTORS.has(f.factor) ? { factor: f.factor, wp_delta_pts: f.wp_delta_pts } : f)),
    };
    return JSON.parse(JSON.stringify(slim, (_k, v) => (v === null || v === false || v === '' ? undefined : v))) as Prediction;
}
