import { signed } from '@/utils/team-stats/format';
import type { TeamStat } from '@/utils/team-stats/types';
import { COLUMN_BY_KEY, COLUMN_GROUPS, type ColumnCtx, type StatColumn } from './columns';

/**
 * The league table's tabs ("lenses"). Each answers one question with a short,
 * curated column set and opens sorted on the column that answers it; group
 * headers can link to the lens that goes deeper. "All" keeps every raw column.
 */

const fin = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const share = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : NaN);
const d1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const d2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const r3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3).replace(/^0/, '') : '—');
const s1 = (v: number) => signed(v, 1);
const s2 = (v: number) => signed(v, 2);
const int = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : '—');

const rt = (row: TeamStat, ctx: ColumnCtx) => ctx.ratings?.[row.tri] ?? null;
const pj = (row: TeamStat, ctx: ColumnCtx) => ctx.projections?.[row.tri] ?? null;
const ratingNet = (row: TeamStat, ctx: ColumnCtx) => {
    const r = rt(row, ctx);
    return r ? fin(r.xgf_rating) - fin(r.xga_rating) : NaN;
};
const stIndex = (row: TeamStat, ctx: ColumnCtx) => {
    const r = rt(row, ctx);
    return r ? fin(r.pp_rating) + fin(r.pk_rating) : NaN;
};

/** A raw column under another label (lens group headers already carry the context). */
const as = (key: string, label: string, extra: Partial<StatColumn> = {}): StatColumn => ({ ...COLUMN_BY_KEY.get(key)!, label, ...extra });

const X = (c: Omit<StatColumn, 'format'> & { format?: StatColumn['format'] }): StatColumn => ({ format: d2, ...c });

/** Columns that exist only in lenses (derived values and drawn cells). */
export const LENS_COLUMNS: Record<string, StatColumn> = {
    // ranks
    rk_power: X({ key: 'rk_power', label: 'Rk', title: 'pony xG power rank (model rating)', better: 'low', kind: 'rank', rankOf: 'rating', model: true }),
    rk_xg: X({ key: 'rk_xg', label: 'Rk', title: 'League rank by xG share', better: 'low', kind: 'rank', rankOf: 'xg_share' }),
    rk_st: X({ key: 'rk_st', label: 'Rk', title: 'League rank by special-teams index', better: 'low', kind: 'rank', rankOf: 'st_index', model: true }),
    rk_ctrl: X({ key: 'rk_ctrl', label: 'Rk', title: 'League rank by game-control score', better: 'low', kind: 'rank', rankOf: 'control' }),
    pos: X({ key: 'pos', label: '#', title: 'Position', better: 'low', kind: 'pos' }),

    // record
    record: X({ key: 'record', label: 'Record', title: 'Wins – regulation losses – OT/SO losses', better: 'none', kind: 'record', derive: r => r.pt_pct, width: 76 }),
    pace: X({ key: 'pace', label: 'Pace', title: 'Points pace over a full season (dim until 10 GP)', better: 'high', derive: (r, c) => r.pt_pct * 2 * c.seasonGames, format: int, thin: r => r.gp < 10 }),
    row_w: X({ key: 'row_w', label: 'ROW', title: 'Regulation + overtime wins (shootout wins excluded)', better: 'high', derive: r => r.row, format: int }),
    home_rec: X({ key: 'home_rec', label: 'Home', title: 'Home record', better: 'none', kind: 'homeRec', width: 76 }),
    away_rec: X({ key: 'away_rec', label: 'Away', title: 'Road record', better: 'none', kind: 'awayRec', width: 76 }),
    l10: X({ key: 'l10', label: 'L10', title: 'Record, last 10 games', better: 'none', kind: 'l10', width: 68 }),
    streak: X({ key: 'streak', label: 'Strk', title: 'Current streak', better: 'none', kind: 'streak', width: 52 }),
    form: X({ key: 'form', label: 'Last games', title: 'xG share each game, oldest to newest (up = more than half)', better: 'none', kind: 'form', width: 96 }),

    // model / projections
    rating: X({ key: 'rating', label: 'xGΔ / game', title: 'Model rating: expected-goal differential per game (xGF − xGA)', better: 'high', kind: 'modelBar', model: true, bar: { mid: 0, span: 0.9 }, derive: ratingNet, format: s2, width: 168 }),
    attack: X({ key: 'attack', label: 'Attack', title: 'Model xG for per game (league rank)', better: 'high', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.xgf_rating) }),
    defense: X({ key: 'defense', label: 'Defense', title: 'Model xG against per game (league rank)', better: 'low', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.xga_rating) }),
    trend: X({ key: 'trend', label: 'Trend', title: 'Recent form (rolling rating) minus the season rating, net xG per game', better: 'none', kind: 'signed', signAt: 0.1, model: true, derive: (r, c) => { const x = rt(r, c); return x ? fin(x.xgf_rolling) - fin(x.xga_rolling) - ratingNet(r, c) : NaN; }, format: s2 }),
    net_5v5: X({ key: 'net_5v5', label: '5v5', title: 'Model 5-on-5 net xG per game', better: 'high', model: true, derive: (r, c) => { const x = rt(r, c); return x ? fin(x.xgf_5v5) - fin(x.xga_5v5) : NaN; }, format: s2 }),
    depth: X({ key: 'depth', label: 'Depth', title: 'Net rating of each forward line (F1–F4) and defence pair (D1–D3): brighter = bigger', better: 'none', kind: 'depth', model: true, derive: (r, c) => (rt(r, c) ? 0 : NaN), width: 196 }),
    goalie_net: X({ key: 'goalie_net', label: 'Goalie', title: 'Model goalie rating: GSAx per game, top two goalies', better: 'high', kind: 'signed', signAt: 0.1, model: true, derive: (r, c) => fin(rt(r, c)?.goalie), format: s2 }),
    playoff: X({ key: 'playoff', label: 'Playoffs', title: 'Chance to make the playoffs (season simulation)', better: 'high', kind: 'odds', model: true, derive: (r, c) => fin(pj(r, c)?.playoff), width: 112 }),
    cup: X({ key: 'cup', label: 'Cup', title: 'Chance to win the Stanley Cup', better: 'high', model: true, derive: (r, c) => fin(pj(r, c)?.cup), format: v => (v < 1 ? '<1%' : `${Math.round(v)}%`) }),
    proj: X({ key: 'proj', label: 'Projected points', title: 'Projected points (tick) and likely range, 10th–90th percentile (band)', better: 'high', kind: 'proj', model: true, derive: (r, c) => fin(pj(r, c)?.points), width: 172 }),

    // xG and shots
    xg_share: X({ key: 'xg_share', label: 'xGF%', title: 'Share of expected goals in their games', better: 'high', kind: 'share', bar: { mid: 50, span: 15 }, derive: r => r.xgf_pct, format: d1, width: 120 }),
    xgf_ord: X({ key: 'xgf_ord', label: 'For / game', title: 'Expected goals for per game (league rank)', better: 'high', kind: 'ordinal', derive: r => r.xgf_per_game }),
    xga_ord: X({ key: 'xga_ord', label: 'Against / game', title: 'Expected goals against per game (league rank)', better: 'low', kind: 'ordinal', derive: r => r.xga_per_game }),
    sog_share: X({ key: 'sog_share', label: 'Shots', title: 'Share of shots on goal', better: 'high', kind: 'share', bar: { mid: 50, span: 15 }, derive: r => share(r.sf_per_game, r.sa_per_game), format: d1, width: 120 }),
    cf_share: X({ key: 'cf_share', label: 'Attempts 5v5', title: 'Share of 5-on-5 shot attempts', better: 'high', kind: 'share', bar: { mid: 50, span: 15 }, derive: r => share(r.cf_per_game, r.ca_per_game), format: d1, width: 120 }),
    hd_share: X({ key: 'hd_share', label: 'High danger', title: 'Share of high-danger chances', better: 'high', kind: 'share', bar: { mid: 50, span: 15 }, derive: r => share(r.hdf_per_game, r.hda_per_game), format: d1, width: 120 }),
    xg_shot_for: X({ key: 'xg_shot_for', label: 'xG / shot for', title: 'Expected goals per shot on goal, own shots (league rank)', better: 'high', kind: 'ordinal', derive: r => (r.sf_per_game > 0 ? r.xgf_per_game / r.sf_per_game : NaN), format: r3 }),
    xg_shot_against: X({ key: 'xg_shot_against', label: 'xG / shot against', title: 'Expected goals per shot on goal allowed (league rank)', better: 'low', kind: 'ordinal', derive: r => (r.sa_per_game > 0 ? r.xga_per_game / r.sa_per_game : NaN), format: r3 }),

    // luck
    gmx: X({ key: 'gmx', label: 'G − xG', title: 'Goals minus expected goals: finishing above or below the chances', better: 'none', kind: 'signed', signAt: 0.5, derive: r => r.gf - r.xgf_per_game * r.gp, format: s1 }),
    xgf_tot: X({ key: 'xgf_tot', label: 'xGF', title: 'Expected goals for', better: 'high', derive: r => r.xgf_per_game * r.gp, format: d1 }),
    xga_tot: X({ key: 'xga_tot', label: 'xGA', title: 'Expected goals against', better: 'low', derive: r => r.xga_per_game * r.gp, format: d1 }),
    xgamg: X({ key: 'xgamg', label: 'xGA − GA', title: 'Expected goals against minus goals against: positive = goals kept out', better: 'none', kind: 'signed', signAt: 0.5, derive: r => r.xga_per_game * r.gp - r.ga, format: s1 }),
    xgd: X({ key: 'xgd', label: 'xGΔ', title: 'Expected-goal differential', better: 'high', derive: r => (r.xgf_per_game - r.xga_per_game) * r.gp, format: s1 }),
    luck: X({ key: 'luck', label: 'GΔ − xGΔ', title: 'Goal differential beyond what the chances earned: + means results ahead of play', better: 'none', kind: 'signed', signAt: 0.5, derive: r => r.goal_diff - (r.xgf_per_game - r.xga_per_game) * r.gp, format: s1 }),
    pdo: X({ key: 'pdo', label: 'PDO', title: 'Shooting % + save % (1000 = average luck)', better: 'none', kind: 'signed', signAt: 20, derive: r => r.sh_pct * 10 + r.sv_pct * 10 - 1000, format: v => String(Math.round(1000 + v)) }),
    gsax_ord: X({ key: 'gsax_ord', label: 'GSAx', title: 'Goals saved above expected (league rank)', better: 'high', kind: 'ordinal', derive: r => r.gsax, format: s1 }),

    // special teams
    st_index: X({ key: 'st_index', label: 'PP% + PK%', title: 'Model power-play % + model penalty-kill % (100 = league average)', better: 'high', kind: 'modelBar', model: true, bar: { mid: 100, span: 6 }, derive: stIndex, format: d1, width: 160 }),
    st_ord: X({ key: 'st_ord', label: 'PP% + PK%', title: 'Model power-play % + model penalty-kill % (100 = league average), league rank', better: 'high', kind: 'ordinal', model: true, rankOf: 'st_index', derive: stIndex, format: d1 }),
    pp_model: X({ key: 'pp_model', label: 'Model', title: 'Model power-play %: this season shrunk toward the league (league rank)', better: 'high', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.pp_rating), format: d1 }),
    pp_xg: X({ key: 'pp_xg', label: 'xG / chance', title: 'Expected goals per power play, shrunk toward the league (≈ .18), league rank', better: 'high', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.pp_xg), format: r3 }),
    pp_frac: X({ key: 'pp_frac', label: 'G / chances', title: 'Power-play goals / chances', better: 'none', kind: 'frac', frac: r => [r.pp_goals, r.pp_opps], derive: r => r.pp_opps, fullGameOnly: true }),
    pk_model: X({ key: 'pk_model', label: 'Model', title: 'Model penalty-kill %: this season shrunk toward the league (league rank)', better: 'high', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.pk_rating), format: d1 }),
    pk_xg: X({ key: 'pk_xg', label: 'xGA / chance', title: 'Expected goals allowed per penalty kill, shrunk toward the league (≈ .18), league rank', better: 'low', kind: 'ordinal', model: true, derive: (r, c) => fin(rt(r, c)?.pk_xg), format: r3 }),
    pk_frac: X({ key: 'pk_frac', label: 'Kills / times', title: 'Kills / times shorthanded', better: 'none', kind: 'frac', frac: r => [r.pk_opps - r.pk_goals_allowed, r.pk_opps], derive: r => r.pk_opps, fullGameOnly: true }),
    st_net: X({ key: 'st_net', label: 'Goals', title: 'Power-play goals minus power-play goals allowed', better: 'none', kind: 'signed', signAt: 0, derive: r => r.pp_goals - r.pk_goals_allowed, format: v => signed(v, 0), fullGameOnly: true }),
    chance_diff: X({ key: 'chance_diff', label: 'Chances / game', title: 'Power plays drawn minus times shorthanded, per game', better: 'none', kind: 'signed', signAt: 0.2, derive: r => (r.gp ? (r.pp_opps - r.pk_opps) / r.gp : NaN), format: s1, fullGameOnly: true }),

    // game state
    flow: X({ key: 'flow', label: 'Leading · tied · trailing, per game', title: 'Time leading (green), tied and trailing (red) per game', better: 'high', kind: 'flow', derive: r => r.time_leading_per_game - r.time_trailing_per_game, width: 300 }),
    control: X({ key: 'control', label: 'Control', title: 'Game-control score (league rank)', better: 'high', kind: 'ordinal', derive: r => r.control_score, format: v => (Number.isFinite(v) ? v.toFixed(3) : '—') }),
    swing: X({ key: 'swing', label: 'Net', title: 'Comeback wins minus blown leads', better: 'none', kind: 'signed', signAt: 0, derive: r => r.cw - r.bl, format: v => signed(v, 0) }),
};

/** Look up a column by key: lens-only columns first, then the raw table's. */
export const lensColumn = (key: string): StatColumn | undefined => LENS_COLUMNS[key] ?? COLUMN_BY_KEY.get(key);

/** Tie a column (or a relabelled raw one) into a lens group. */
type Col = string | StatColumn;

export interface LensGroup {
    name: string;
    cols: Col[];
    /** Lens this group's header opens. */
    link?: LensKey;
}

export type LensKey = 'overview' | 'standings' | 'luck' | 'special' | 'shots' | 'state' | 'ratings' | 'all';

export interface Lens {
    key: LensKey;
    label: string;
    groups: LensGroup[];
    sort: { key: string; dir: 'asc' | 'desc' };
}

const g = (name: string, cols: Col[], link?: LensKey): LensGroup => ({ name, cols, link });

export const LENSES: Lens[] = [
    {
        key: 'overview',
        label: 'Overview',
        sort: { key: 'rk_power', dir: 'asc' },
        groups: [
            g('', ['rk_power']),
            g('Record', ['record', as('points', 'PTS')], 'standings'),
            g('Rating', ['rating'], 'ratings'),
            g('Play', ['xg_share'], 'shots'),
            g('Luck', ['luck'], 'luck'),
            g('Special teams', ['st_ord'], 'special'),
            g('Goalie', ['gsax_ord'], 'luck'),
            g('Form', ['form'], 'state'),
            g('Odds', ['playoff'], 'standings'),
        ],
    },
    {
        key: 'standings',
        label: 'Standings',
        sort: { key: 'points', dir: 'desc' },
        groups: [
            g('', ['pos']),
            g('Record', ['gp', 'wins', 'losses', 'otl', 'points', 'pt_pct', 'pace']),
            g('Tiebreak', ['rw', 'row_w']),
            g('Splits', ['home_rec', 'away_rec']),
            g('Recent', ['l10', 'streak']),
            g('Goals', [as('goal_diff', 'GΔ')]),
            g('Model', ['proj', 'playoff', 'cup']),
        ],
    },
    {
        key: 'luck',
        label: 'Luck',
        sort: { key: 'luck', dir: 'desc' },
        groups: [
            g('', ['ranking']),
            g('Scoring', [as('gf', 'GF', { better: 'high' }), 'xgf_tot', 'gmx']),
            g('Preventing', [as('ga', 'GA', { better: 'low' }), 'xga_tot', 'xgamg']),
            g('Net', ['goal_diff', 'xgd', 'luck']),
            g('Bounces', ['sh_pct', 'sv_pct', 'pdo']),
            g('Goalie', ['gsax_ord']),
            g('Goals per game', ['gf_per_game', 'ga_per_game', 'true_gf_per_game', 'true_ga_per_game', 'true_goal_diff', 'total_goals_per_game']),
        ],
    },
    {
        key: 'special',
        label: 'Special teams',
        sort: { key: 'st_index', dir: 'desc' },
        groups: [
            g('', ['rk_st']),
            g('Overall', ['st_index']),
            g('Power play', ['pp_model', 'pp_xg', as('pp_pct', 'Actual'), 'pp_frac']),
            g('Penalty kill', ['pk_model', 'pk_xg', as('pk_pct', 'Actual'), 'pk_frac']),
            g('Net', ['st_net', 'chance_diff']),
            g('PP usage', [as('pp_lev', 'Lev'), as('pp_time_per_game', 'TOI / game'), as('pp_time_per_goal', 'TOI / goal')]),
            g('PK usage', [as('pk_lev', 'Lev'), as('pk_time_per_game', 'TOI / game'), as('pk_time_per_goal_allowed', 'TOI / goal')]),
        ],
    },
    {
        key: 'shots',
        label: 'Shots',
        sort: { key: 'xg_share', dir: 'desc' },
        groups: [
            g('', ['rk_xg']),
            g('xG', ['xg_share', 'xgf_ord', 'xga_ord']),
            g('Share of', ['sog_share', 'cf_share', 'hd_share']),
            g('Quality', ['xg_shot_for', 'xg_shot_against']),
            g('Finish', ['sh_pct', 'gmx']),
        ],
    },
    {
        key: 'state',
        label: 'Game state',
        sort: { key: 'control', dir: 'desc' },
        groups: [
            g('', ['rk_ctrl']),
            g('Flow', ['flow', 'control']),
            g('Lead states', ['ntw', 'nlw', 'ntl']),
            g('Blown leads', [as('bl', 'Total'), as('bl_3p', 'In 3rd'), as('bl_2plus', 'Up 2+'), as('bl_3plus', 'Up 3+')]),
            g('Comebacks', [as('cw', 'Total'), as('cw_3p', 'In 3rd'), as('cw_2plus', 'Down 2+'), as('cw_3plus', 'Down 3+')]),
            g('Swing', ['swing']),
            g('Empty net', [as('engf', 'ENGF'), as('en_attempts', 'Shots at EN'), 'ens_pct', as('enga', 'ENGA'), 'otmw', 'otml']),
        ],
    },
    {
        key: 'ratings',
        label: 'Ratings',
        sort: { key: 'rating', dir: 'desc' },
        groups: [
            g('', ['rk_power']),
            g('Model', ['rating', 'attack', 'defense']),
            g('Form', ['trend', 'net_5v5']),
            g('Roster', ['depth', 'goalie_net', as('lineup_rating', 'Lineup'), as('f_impact', 'F'), as('d_impact', 'D'), as('rapm_f', 'F RAPM'), as('rapm_d', 'D RAPM')]),
        ],
    },
    {
        key: 'all',
        label: 'All',
        sort: { key: 'points', dir: 'desc' },
        groups: COLUMN_GROUPS.map(gr => g(gr.name, gr.cols)),
    },
];

export const LENS_BY_KEY = new Map(LENSES.map(l => [l.key, l]));
export const isLensKey = (k: string | null | undefined): k is LensKey => !!k && LENS_BY_KEY.has(k as LensKey);

/** A lens's columns, resolved, each with its group name, link and group-end flag. */
export function lensColumns(lens: Lens): { col: StatColumn; group: string; link?: LensKey; groupEnd: boolean }[] {
    return lens.groups.flatMap(gr => {
        const cols = gr.cols.map(c => (typeof c === 'string' ? lensColumn(c) : c)).filter((c): c is StatColumn => !!c);
        return cols.map((col, i) => ({ col, group: gr.name, link: gr.link, groupEnd: i === cols.length - 1 }));
    });
}

