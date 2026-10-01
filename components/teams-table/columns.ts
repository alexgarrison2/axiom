import type { GlossaryTerm } from '@/lib/glossary';
import { mmss, pct3, signed } from '@/utils/team-stats/format';
import type { TeamRatingEntry, TeamStat } from '@/utils/team-stats/types';

export type Better = 'high' | 'low' | 'none';

export interface StatColumn {
    key: string;
    label: string;
    title: string;
    tip?: GlossaryTerm;
    better: Better;
    /** No per-period data (PP/PK, empty net): blank when a period filter is on. */
    fullGameOnly?: boolean;
    format: (v: number) => string;
    /** Value source: 'rating' columns read the Ratings payload. */
    rating?: (r: TeamRatingEntry) => number | null;
}

const int = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const d1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const d2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const pc1 = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');
const pc0 = (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)}%` : '—');
const sv = (v: number) => (Number.isFinite(v) ? pct3(v / 100) : '—');
const s0 = (v: number) => signed(v, 0);
const s2 = (v: number) => signed(v, 2);

const C = (key: string, label: string, title: string, better: Better, format: (v: number) => string, extra: Partial<StatColumn> = {}): StatColumn => ({
    key,
    label,
    title,
    better,
    format,
    ...extra,
});

export const COLUMNS: StatColumn[] = [
    C('ranking', 'Rank', 'Division rank (playoff position)', 'none', () => ''),
    C('gp', 'GP', 'Games played', 'none', int),
    C('wins', 'W', 'Wins', 'high', int),
    C('losses', 'L', 'Regulation losses (every loss in the playoffs)', 'low', int),
    C('otl', 'OT', 'Overtime and shootout losses', 'none', int),
    C('points', 'PTS', 'Points (2 per win, 1 per OT/SO loss)', 'high', int),
    C('pt_pct', 'P%', 'Points percentage', 'high', pct3, { tip: 'points-pct' }),
    C('rw', 'RW', 'Regulation wins (first tiebreaker)', 'high', int, { tip: 'points-pct' }),

    C('gf_per_game', 'GF/G', 'Goals for per game (shootout winner credited one goal)', 'high', d2),
    C('ga_per_game', 'GA/G', 'Goals against per game (shootout convention)', 'low', d2),
    C('goal_diff', 'GΔ', 'Goal differential', 'high', s0),
    C('true_gf_per_game', 'TruGF', 'True goals for per game (no PP or empty-net goals)', 'high', d2, { tip: 'true-goals' }),
    C('true_ga_per_game', 'TruGA', 'True goals against per game', 'low', d2, { tip: 'true-goals' }),
    C('true_goal_diff', 'TruGΔ', 'True goal differential', 'high', s0, { tip: 'true-goals' }),
    C('total_goals_per_game', 'Tot/G', 'Total goals (for + against) per game', 'none', d2),

    C('pp_goals', 'PPG', 'Power-play goals', 'high', int, { fullGameOnly: true }),
    C('pp_opps', 'PPO', 'Power-play opportunities', 'none', int, { fullGameOnly: true }),
    C('pp_pct', 'PP%', 'Power-play percentage', 'high', pc1, { tip: 'pp-pk', fullGameOnly: true }),
    C('pp_lev', 'PPLev', 'Share of goals scored on the power play', 'none', pc0, { tip: 'pp-leverage', fullGameOnly: true }),
    C('pp_time_per_game', 'PP T/GP', 'Power-play time per game', 'none', mmss, { fullGameOnly: true }),
    C('pp_time_per_goal', 'PP T/G', 'Power-play time per power-play goal', 'low', mmss, { fullGameOnly: true }),
    C('pk_goals_allowed', 'PPGA', 'Power-play goals allowed', 'low', int, { fullGameOnly: true }),
    C('pk_opps', 'TSH', 'Times shorthanded', 'none', int, { fullGameOnly: true }),
    C('pk_pct', 'PK%', 'Penalty-kill percentage', 'high', pc1, { tip: 'pp-pk', fullGameOnly: true }),
    C('pk_lev', 'PKLev', 'Share of goals allowed while shorthanded', 'none', pc0, { tip: 'pp-leverage', fullGameOnly: true }),
    C('pk_time_per_game', 'PK T/GP', 'Penalty-kill time per game', 'none', mmss, { fullGameOnly: true }),
    C('pk_time_per_goal_allowed', 'PK T/GA', 'Penalty-kill time per goal allowed', 'high', mmss, { fullGameOnly: true }),

    C('sv_pct', 'Sv%', 'Save percentage (empty-net goals excluded)', 'high', sv),
    C('gsax', 'GSAx', 'Goals saved above expected (season total)', 'high', s2, { tip: 'gsax' }),
    C('sf_per_game', 'SF/G', 'Shots on goal for per game', 'high', d1),
    C('sa_per_game', 'SA/G', 'Shots on goal against per game', 'low', d1),
    C('cf_per_game', 'CF/G', '5-on-5 shot attempts for per game', 'high', d1, { tip: 'shot-attempts' }),
    C('ca_per_game', 'CA/G', '5-on-5 shot attempts against per game', 'low', d1, { tip: 'shot-attempts' }),
    C('hdf_per_game', 'HDF/G', 'High-danger chances for per game', 'high', d1, { tip: 'high-danger' }),
    C('hda_per_game', 'HDA/G', 'High-danger chances against per game', 'low', d1, { tip: 'high-danger' }),
    C('sh_pct', 'Sh%', 'Shooting percentage', 'high', pc1),

    C('xgf_per_game', 'xGF/G', 'Expected goals for per game', 'high', d2, { tip: 'xg' }),
    C('xga_per_game', 'xGA/G', 'Expected goals against per game', 'low', d2, { tip: 'xg' }),
    C('xgf_pct', 'xGF%', 'Share of expected goals', 'high', pc1, { tip: 'xg' }),

    C('time_leading_per_game', 'T↑/G', 'Time leading per game', 'high', mmss, { tip: 'control-score' }),
    C('time_trailing_per_game', 'T↓/G', 'Time trailing per game', 'low', mmss, { tip: 'control-score' }),
    C('time_tied_per_game', 'T=/G', 'Time tied per game', 'none', mmss),
    C('control_score', 'Control', 'Game-control score', 'high', v => (Number.isFinite(v) ? v.toFixed(3) : '—'), { tip: 'control-score' }),
    C('nlw', 'NLW', 'Wins without ever leading', 'high', int, { tip: 'lead-states' }),
    C('ntw', 'NTW', 'Wins without ever trailing', 'high', int, { tip: 'lead-states' }),
    C('ntl', 'NTL', 'Losses without ever trailing', 'low', int, { tip: 'lead-states' }),

    C('bl', 'BL', 'Blown leads', 'low', int, { tip: 'blown-leads' }),
    C('bl_3p', 'BL(3P)', 'Blown third-period leads', 'low', int, { tip: 'blown-leads' }),
    C('bl_2plus', 'BL(2+)', 'Blown two-goal leads', 'low', int, { tip: 'blown-leads' }),
    C('bl_3plus', 'BL(3+)', 'Blown three-goal leads', 'low', int, { tip: 'blown-leads' }),
    C('cw', 'CW', 'Comeback wins', 'high', int, { tip: 'blown-leads' }),
    C('cw_3p', 'CW(3P)', 'Third-period comeback wins', 'high', int, { tip: 'blown-leads' }),
    C('cw_2plus', 'CW(2+)', 'Comebacks from two down', 'high', int, { tip: 'blown-leads' }),
    C('cw_3plus', 'CW(3+)', 'Comebacks from three down', 'high', int, { tip: 'blown-leads' }),

    C('engf', 'EN GF', 'Empty-net goals for', 'high', int, { tip: 'empty-net', fullGameOnly: true }),
    C('en_attempts', 'EN Att', 'Attempts at an empty net', 'none', int, { tip: 'empty-net', fullGameOnly: true }),
    C('ens_pct', 'ENS%', 'Empty-net success rate', 'high', pc1, { tip: 'empty-net', fullGameOnly: true }),
    C('otml', 'OtmL', 'Losses after pulling the goalie', 'low', int, { tip: 'empty-net', fullGameOnly: true }),
    C('enga', 'EN GA', 'Empty-net goals against', 'low', int, { tip: 'empty-net', fullGameOnly: true }),

    // Ratings (current ratings; season-independent)
    C('xgf_rating', 'xGF Rtg', 'xG-for rating (season + recent blend)', 'high', d2, { tip: 'xg', rating: r => r.xgf_rating }),
    C('xga_rating', 'xGA Rtg', 'xG-against rating (season + recent blend)', 'low', d2, { tip: 'xg', rating: r => r.xga_rating }),
    C('xgf_rolling', 'xGF Roll', 'xG for, rolling (7-game half-life)', 'high', d2, { rating: r => r.xgf_rolling }),
    C('xga_rolling', 'xGA Roll', 'xG against, rolling (7-game half-life)', 'low', d2, { rating: r => r.xga_rolling }),
    C('xgf_5v5', 'xGF 5v5', '5-on-5 xG-for rating', 'high', d2, { rating: r => r.xgf_5v5 }),
    C('xga_5v5', 'xGA 5v5', '5-on-5 xG-against rating', 'low', d2, { rating: r => r.xga_5v5 }),
    C('lineup_rating', 'Lineup', 'Lineup NET: all seven lines plus the goalies', 'high', d2, {
        tip: 'player-net',
        rating: r => r.lines.f1 + r.lines.f2 + r.lines.f3 + r.lines.f4 + r.lines.d1 + r.lines.d2 + r.lines.d3 + r.goalie,
    }),
    C('f1_impact', 'F1', 'First line NET (xG/60)', 'high', d2, { rating: r => r.lines.f1 }),
    C('f2_impact', 'F2', 'Second line NET (xG/60)', 'high', d2, { rating: r => r.lines.f2 }),
    C('f3_impact', 'F3', 'Third line NET (xG/60)', 'high', d2, { rating: r => r.lines.f3 }),
    C('f4_impact', 'F4', 'Fourth line NET (xG/60)', 'high', d2, { rating: r => r.lines.f4 }),
    C('d1_impact', 'D1', 'Top pair NET (xG/60)', 'high', d2, { rating: r => r.lines.d1 }),
    C('d2_impact', 'D2', 'Second pair NET (xG/60)', 'high', d2, { rating: r => r.lines.d2 }),
    C('d3_impact', 'D3', 'Third pair NET (xG/60)', 'high', d2, { rating: r => r.lines.d3 }),
    C('f_impact', 'F Tot', 'All forwards NET (xG/60)', 'high', d2, { rating: r => r.lines.f1 + r.lines.f2 + r.lines.f3 + r.lines.f4 }),
    C('d_impact', 'D Tot', 'All defence NET (xG/60)', 'high', d2, { rating: r => r.lines.d1 + r.lines.d2 + r.lines.d3 }),
    C('rapm_f', 'F RAPM', 'Forwards, TOI-weighted RAPM', 'high', d2, { tip: 'player-net', rating: r => r.rapm.f }),
    C('rapm_d', 'D RAPM', 'Defence, TOI-weighted RAPM', 'high', d2, { tip: 'player-net', rating: r => r.rapm.d }),
    C('goalie_impact', 'G Impact', 'Goalie impact (GSAx per game, top two goalies)', 'high', d2, { tip: 'gsax', rating: r => r.goalie }),
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map(c => [c.key, c]));

export interface SectionGroup {
    name: string;
    cols: string[];
}

export interface Section {
    key: string;
    label: string;
    groups: SectionGroup[];
}

const G = (name: string, cols: string[]): SectionGroup => ({ name, cols });

const RECORD = G('Record', ['ranking', 'gp', 'wins', 'losses', 'otl', 'points', 'pt_pct', 'rw']);
const GOALS = G('Goals', ['gf_per_game', 'ga_per_game', 'goal_diff', 'true_gf_per_game', 'true_ga_per_game', 'true_goal_diff', 'total_goals_per_game']);
const PP = G('Power play', ['pp_goals', 'pp_opps', 'pp_pct', 'pp_lev', 'pp_time_per_game', 'pp_time_per_goal']);
const PK = G('Penalty kill', ['pk_goals_allowed', 'pk_opps', 'pk_pct', 'pk_lev', 'pk_time_per_game', 'pk_time_per_goal_allowed']);
const SAVES = G('Goaltending', ['sv_pct', 'gsax']);
const SHOTS = G('Shots', ['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game', 'hdf_per_game', 'hda_per_game', 'sh_pct']);
const XG = G('Expected goals', ['xgf_per_game', 'xga_per_game', 'xgf_pct']);
const STATE = G('Game state', ['time_leading_per_game', 'time_trailing_per_game', 'time_tied_per_game', 'control_score', 'nlw', 'ntw', 'ntl']);
const COMEBACKS = G('Leads & comebacks', ['bl', 'bl_3p', 'bl_2plus', 'bl_3plus', 'cw', 'cw_3p', 'cw_2plus', 'cw_3plus']);
const EN = G('Empty net', ['engf', 'en_attempts', 'ens_pct', 'otml', 'enga']);

export const SECTIONS: Section[] = [
    {
        key: 'overview',
        label: 'Overview',
        groups: [G('Record', ['points', 'pt_pct', 'gp', 'ranking', 'wins', 'losses', 'otl']), G('Form', ['goal_diff', 'xgf_pct', 'pp_pct', 'pk_pct'])],
    },
    { key: 'record', label: 'Record', groups: [RECORD] },
    { key: 'goals', label: 'Goals', groups: [RECORD_MIN(), GOALS] },
    { key: 'special', label: 'PP/PK', groups: [RECORD_MIN(), PP, PK] },
    { key: 'shots', label: 'Shots', groups: [RECORD_MIN(), SAVES, SHOTS] },
    { key: 'xg', label: 'xG', groups: [RECORD_MIN(), XG, SAVES] },
    { key: 'state', label: 'State', groups: [RECORD_MIN(), STATE, COMEBACKS] },
    { key: 'empty-net', label: 'Empty net', groups: [RECORD_MIN(), EN] },
    {
        key: 'ratings',
        label: 'Ratings',
        groups: [
            RECORD_MIN(),
            G('xG ratings', ['xgf_rating', 'xga_rating', 'xgf_rolling', 'xga_rolling', 'xgf_5v5', 'xga_5v5']),
            G('Lineup NET', ['lineup_rating', 'f1_impact', 'f2_impact', 'f3_impact', 'f4_impact', 'd1_impact', 'd2_impact', 'd3_impact', 'f_impact', 'd_impact']),
            G('RAPM & goalie', ['rapm_f', 'rapm_d', 'goalie_impact']),
        ],
    },
    { key: 'all', label: 'All', groups: [RECORD, GOALS, PP, PK, SAVES, SHOTS, XG, STATE, COMEBACKS, EN] },
];

function RECORD_MIN(): SectionGroup {
    return G('Record', ['gp', 'points', 'pt_pct']);
}

export const SECTION_KEYS = SECTIONS.map(s => s.key);

/** Value of a column for a team row (ratings read the Ratings payload). */
export function columnValue(col: StatColumn, row: TeamStat, ratings: Record<string, TeamRatingEntry> | null): number {
    if (col.rating) {
        const r = ratings?.[row.tri];
        const v = r ? col.rating(r) : null;
        return v === null || v === undefined ? NaN : v;
    }
    const v = (row as unknown as Record<string, unknown>)[col.key];
    return typeof v === 'number' ? v : v === null ? NaN : NaN;
}

// ── colour ────────────────────────────────────────────────────────────────────
// Diverging cell-background tint by league rank: cool cyan (the --brand hue)
// for good, warm orange for bad, untinted around the league median. Blue vs
// orange is the colour-blind-safe diverging pair, and the text stays --text-1
// on every tint (contrast checked in columns.test.ts). The tint is laid over
// the cell's own background (zebra / hover) as a background-image, so those
// row states still show through.

export const HEAT_GOOD: readonly [number, number, number] = [41, 231, 255];
export const HEAT_BAD: readonly [number, number, number] = [255, 138, 61];
/** Strongest tint alpha. Orange is darker than cyan, so it gets a little more to read as equally strong. */
export const HEAT_MAX_ALPHA = { good: 0.3, bad: 0.36 } as const;
/** Below this strength a cell stays untinted (the neutral middle of the league). */
const HEAT_FLOOR = 0.06;
/** Games after which a team's tint reaches full strength. */
export const HEAT_FULL_GP = 10;

/**
 * Where `value` sits in the league, 0 (lowest) to 1 (highest), by mid-rank so
 * tied values share a position. `sorted` is every team's value, ascending.
 */
export function leaguePercentile(value: number, sorted: readonly number[]): number | null {
    if (!Number.isFinite(value) || sorted.length < 2) return null;
    let below = 0;
    let equal = 0;
    for (const v of sorted) {
        if (v < value) below++;
        else if (v === value) equal++;
    }
    const pos = below + Math.max(0, equal - 1) / 2;
    return Math.max(0, Math.min(1, pos / (sorted.length - 1)));
}

/**
 * How much of the tint a team's sample earns: under half at 1 GP, full at
 * HEAT_FULL_GP. Early-season colour is honest (faint) rather than missing.
 */
export function sampleWeight(gp: number): number {
    if (!(gp > 0)) return 0;
    return Math.min(1, 0.4 + 0.6 * (gp / HEAT_FULL_GP));
}

/**
 * Cell tint for a league percentile (see leaguePercentile), as an rgb() colour
 * with alpha, or undefined for the untinted middle / unrated columns.
 * `weight` (0–1) scales the strength, e.g. sampleWeight(gp).
 */
export function heatTint(percentile: number | null, better: Better, weight = 1): string | undefined {
    if (better === 'none' || percentile === null || !Number.isFinite(percentile)) return undefined;
    let d = Math.max(0, Math.min(1, percentile)) * 2 - 1; // -1 lowest … +1 highest
    if (better === 'low') d = -d;
    const strength = Math.abs(d) * Math.max(0, Math.min(1, weight));
    if (strength < HEAT_FLOOR) return undefined;
    const good = d > 0;
    const [r, g, b] = good ? HEAT_GOOD : HEAT_BAD;
    const a = Math.round(strength * (good ? HEAT_MAX_ALPHA.good : HEAT_MAX_ALPHA.bad) * 1000) / 1000;
    return `rgb(${r} ${g} ${b} / ${a})`;
}
