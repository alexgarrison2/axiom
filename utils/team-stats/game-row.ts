import { gameTypeOf, seasonOfGameId } from './season';
import type { GameRow, PackedGames, PeriodSplits, Quad, ResultCode } from './types';

const RESULTS = new Set<ResultCode>(['RW', 'OTW', 'SOW', 'RL', 'OTL', 'SOL']);
const P = ['1P', '2P', '3P', 'OT'] as const;

const num = (v: unknown): number => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
};

const quad = (raw: Record<string, unknown>, prefix: string): Quad =>
    [num(raw[`${prefix}_1P`]), num(raw[`${prefix}_2P`]), num(raw[`${prefix}_3P`]), num(raw[`${prefix}_OT`])];

/** Per-period time/control fall back to the full-game value when missing (older rows). */
const quadOr = (raw: Record<string, unknown>, prefix: string, full: number): Quad =>
    P.map(p => {
        const v = raw[`${prefix}_${p}`];
        return v === undefined || v === null || v === '' ? full : num(v);
    }) as Quad;

export const isWin = (r: ResultCode) => r === 'RW' || r === 'OTW' || r === 'SOW';
export const isLoss = (r: ResultCode) => r === 'RL' || r === 'OTL' || r === 'SOL';

/**
 * Parse one gamestats.csv row. `teamToTri` maps the CSV's common names
 * ("Oilers") to tricodes. Returns null for rows we do not show (preseason,
 * all-star, international games, unknown teams or results).
 */
export function parseGameRow(raw: Record<string, unknown>, teamToTri: (name: string) => string | undefined): GameRow | null {
    const id = String(raw.game_id ?? '').trim();
    const type = gameTypeOf(id);
    if (!type) return null;
    const tri = teamToTri(String(raw.team ?? '').trim());
    const opp = teamToTri(String(raw.opponent ?? '').trim());
    const result = String(raw.result ?? '').trim() as ResultCode;
    if (!tri || !opp || !RESULTS.has(result)) return null;

    const tl = num(raw.time_leading);
    const tt = num(raw.time_trailing);
    const tti = num(raw.time_tied);
    const ctrlRaw = raw.control_score;
    const ctrl = ctrlRaw === '' || ctrlRaw === undefined || ctrlRaw === null ? 1 : num(ctrlRaw);

    const p: PeriodSplits = {
        gf: quad(raw, 'goals_for'),
        ga: quad(raw, 'goals_ag'),
        sf: quad(raw, 'sog_for'),
        sa: quad(raw, 'sog_ag'),
        cf: quad(raw, 'attempts_for'),
        ca: quad(raw, 'attempts_ag'),
        hdf: quad(raw, 'hdf'),
        hda: quad(raw, 'hda'),
        xgf: quad(raw, 'xg_for'),
        xga: quad(raw, 'xg_ag'),
        tl: quadOr(raw, 'time_leading', tl),
        tt: quadOr(raw, 'time_trailing', tt),
        tti: quadOr(raw, 'time_tied', tti),
        ctrl: quadOr(raw, 'control_score', ctrl),
    };

    const sf1 = String(raw.scored_first ?? '').trim();
    return {
        id,
        date: String(raw.game_date ?? '').slice(0, 10),
        season: seasonOfGameId(id),
        type,
        tri,
        opp,
        home: String(raw.home_away ?? '') === 'Home',
        result,
        gn: 0,
        gf: num(raw.goals_for),
        ga: num(raw.goals_ag),
        sf: num(raw.sog_for),
        sa: num(raw.sog_ag),
        cf: num(raw.attempts_for),
        ca: num(raw.attempts_ag),
        cf5: num(raw.attempts_for_5v5),
        ca5: num(raw.attempts_ag_5v5),
        hdf: num(raw.hdf),
        hda: num(raw.hda),
        xgf: num(raw.xG_for),
        xga: num(raw.xG_against),
        xgane: raw.xga_non_en !== undefined && raw.xga_non_en !== '' && raw.xga_non_en !== null ? num(raw.xga_non_en) : num(raw.xG_against),
        ppg: num(raw.pp_goals),
        ppga: num(raw.pp_goals_against),
        ppo: num(raw.pp_opportunities),
        pko: num(raw.pk_opportunities),
        ppt: num(raw.pp_time),
        pkt: num(raw.pk_time),
        saves: num(raw.saves_for),
        engf: num(raw.emptynet_goalsfor),
        enga: num(raw.emptynet_goalsagainst),
        enppgf: num(raw.en_pp_goalsfor),
        enppga: num(raw.en_pp_goalsagainst),
        enatt: num(raw.en_attempts_for),
        enattag: num(raw.en_attempts_against),
        tl,
        tt,
        tti,
        ctrl,
        sfirst: sf1 === '1' || sf1 === '1.0' || sf1 === 'true' || sf1 === 'True' ? 1 : 0,
        bl1: num(raw.blownlead_1),
        bl2: num(raw.blownlead_2),
        bl3: num(raw['blownlead_3+']),
        cw1: num(raw.comeback_1),
        cw2: num(raw.comeback_2),
        cw3: num(raw['comeback_3+']),
        starter: String(raw.starting_goalie ?? '').trim(),
        oppStarter: String(raw.starting_goalie_opp ?? '').trim(),
        p,
    };
}

/**
 * Post-process a season's rows:
 * - the pipeline sometimes leaves attempts_ag_5v5 at 0; mirror it from the
 *   opponent's attempts_for_5v5 in the same game.
 * - assign game numbers per (team, game type), oldest first.
 * Returns rows sorted newest first.
 */
export function finalizeRows(rows: GameRow[]): GameRow[] {
    const byGame = new Map<string, GameRow[]>();
    for (const r of rows) {
        const list = byGame.get(r.id);
        if (list) list.push(r);
        else byGame.set(r.id, [r]);
    }
    for (const r of rows) {
        if (r.ca5 === 0) {
            const other = byGame.get(r.id)?.find(o => o.tri !== r.tri);
            if (other && other.cf5 > 0) r.ca5 = other.cf5;
        }
    }
    const sorted = [...rows].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
    const counters = new Map<string, number>();
    for (const r of sorted) {
        const k = `${r.tri}|${r.type}`;
        const n = (counters.get(k) ?? 0) + 1;
        counters.set(k, n);
        r.gn = n;
    }
    return sorted.reverse();
}

// ── Packing (compact JSON for the browser) ───────────────────────────────────

const SCALARS = [
    'gf', 'ga', 'sf', 'sa', 'cf', 'ca', 'cf5', 'ca5', 'hdf', 'hda', 'xgf', 'xga', 'xgane',
    'ppg', 'ppga', 'ppo', 'pko', 'ppt', 'pkt', 'saves',
    'engf', 'enga', 'enppgf', 'enppga', 'enatt', 'enattag',
    'tl', 'tt', 'tti', 'ctrl', 'sfirst', 'bl1', 'bl2', 'bl3', 'cw1', 'cw2', 'cw3',
] as const;
const SPLITS = ['gf', 'ga', 'sf', 'sa', 'cf', 'ca', 'hdf', 'hda', 'xgf', 'xga', 'tl', 'tt', 'tti', 'ctrl'] as const;
const HEAD = ['id', 'date', 'type', 'tri', 'opp', 'home', 'result', 'gn', 'starter', 'oppStarter'] as const;

const round = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);

/** `periods: false` drops the per-period splits (~60% of the payload). */
export function packGames(rows: GameRow[], opts: { periods?: boolean } = {}): PackedGames {
    const periods = opts.periods !== false;
    const starters: string[] = [];
    const idx = new Map<string, number>();
    const sIdx = (name: string) => {
        let i = idx.get(name);
        if (i === undefined) {
            i = starters.length;
            starters.push(name);
            idx.set(name, i);
        }
        return i;
    };
    const cols = [...HEAD, ...SCALARS, ...(periods ? SPLITS.flatMap(s => P.map(p => `${s}_${p}`)) : [])];
    const out = rows.map(r => [
        r.id, r.date, r.type, r.tri, r.opp, r.home ? 1 : 0, r.result, r.gn, sIdx(r.starter), sIdx(r.oppStarter),
        ...SCALARS.map(k => round(r[k] as number)),
        ...(periods ? SPLITS.flatMap(s => r.p[s].map(round)) : []),
    ]);
    return { cols, starters, rows: out, periods };
}

export function unpackGames(packed: PackedGames): GameRow[] {
    const { cols, starters, rows } = packed;
    const at = new Map(cols.map((c, i) => [c, i]));
    const g = (row: (string | number)[], c: string) => row[at.get(c)!];
    return rows.map(row => {
        const p = {} as PeriodSplits;
        for (const s of SPLITS) p[s] = (packed.periods ? P.map(pp => Number(g(row, `${s}_${pp}`))) : [0, 0, 0, 0]) as Quad;
        const r = {
            id: String(g(row, 'id')),
            date: String(g(row, 'date')),
            season: seasonOfGameId(String(g(row, 'id'))),
            type: Number(g(row, 'type')) as 2 | 3,
            tri: String(g(row, 'tri')),
            opp: String(g(row, 'opp')),
            home: Number(g(row, 'home')) === 1,
            result: String(g(row, 'result')) as ResultCode,
            gn: Number(g(row, 'gn')),
            starter: starters[Number(g(row, 'starter'))] ?? '',
            oppStarter: starters[Number(g(row, 'oppStarter'))] ?? '',
            p,
        } as GameRow;
        for (const k of SCALARS) (r as unknown as Record<string, number>)[k] = Number(g(row, k));
        // Packs written before xgane existed: fall back to xga.
        if (!Number.isFinite(r.xgane)) r.xgane = r.xga;
        return r;
    });
}

/**
 * Goals saved above expected for a full game: non-empty-net xG against minus
 * goals allowed with the goalie in net. Opponent empty-net shots never count.
 */
export function gsaxOf(g: Pick<GameRow, 'xga' | 'xgane' | 'ga' | 'enga'>): number {
    const xg = Number.isFinite(g.xgane) ? g.xgane : g.xga;
    return xg - (g.ga - g.enga);
}
