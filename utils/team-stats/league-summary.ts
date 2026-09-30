import type { KpiSet } from './team-types';
import type { TeamStat } from './types';

/** 1 = best. Ties share the better rank. */
export function rankOf(value: number, all: number[], higherIsBetter: boolean): number {
    return 1 + all.filter(v => (higherIsBetter ? v > value : v < value)).length;
}

/** League ranks appear once every team has played this many games. */
export const RANK_MIN_GP = 10;

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** League ranks for the team-page KPI tiles (only teams with games count). */
export function leaguesSummary(rows: TeamStat[]) {
    const played = rows.filter(s => s.gp > 0);
    const col = (k: keyof TeamStat) => played.map(s => Number(s[k]));
    const cols = {
        xgf_pct: col('xgf_pct'),
        gf_pg: col('gf_per_game'),
        ga_pg: col('ga_per_game'),
        pp_pct: col('pp_pct'),
        pk_pct: col('pk_pct'),
        pt_pct: col('pt_pct'),
    };
    // Same gate as the matchup PP/PK ranks: no league ranks until every team has 10+ GP.
    const ranked = rows.length > 0 && rows.every(s => s.gp >= RANK_MIN_GP);
    return {
        teams: played.length,
        kpis(tri: string): KpiSet | null {
            const s = rows.find(x => x.tri === tri);
            if (!s || s.gp === 0) return null;
            return {
                xgf_pct: r(s.xgf_pct, 1),
                gf_pg: r(s.gf_per_game, 2),
                ga_pg: r(s.ga_per_game, 2),
                pp_pct: r(s.pp_pct, 1),
                pk_pct: r(s.pk_pct, 1),
                pp_opps: s.pp_opps,
                pk_opps: s.pk_opps,
                pt_pct: r(s.pt_pct, 3),
                ranked,
                ranks: {
                    xgf_pct: rankOf(s.xgf_pct, cols.xgf_pct, true),
                    gf_pg: rankOf(s.gf_per_game, cols.gf_pg, true),
                    ga_pg: rankOf(s.ga_per_game, cols.ga_pg, false),
                    pp_pct: rankOf(s.pp_pct, cols.pp_pct, true),
                    pk_pct: rankOf(s.pk_pct, cols.pk_pct, true),
                    pt_pct: rankOf(s.pt_pct, cols.pt_pct, true),
                },
            };
        },
    };
}
