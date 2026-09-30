import { isLoss, isWin } from './game-row';
import type { GameRow, PeriodFilter, TeamStat } from './types';

const PERIOD_INDEX: Record<Exclude<PeriodFilter, 'All'>, number> = { '1st': 0, '2nd': 1, '3rd': 2, OT: 3 };

export function emptyTeamStat(tri: string): TeamStat {
    return {
        tri, gp: 0, wins: 0, losses: 0, otl: 0, points: 0, pt_pct: 0, rw: 0, row: 0,
        gf: 0, ga: 0, gf_per_game: 0, ga_per_game: 0, goal_diff: 0, true_goal_diff: 0,
        true_gf_per_game: 0, true_ga_per_game: 0, total_goals_per_game: 0,
        pp_goals: 0, pp_opps: 0, pp_pct: 0, pp_lev: 0, pp_time_per_game: 0, pp_time_per_goal: null,
        pk_goals_allowed: 0, pk_opps: 0, pk_pct: 0, pk_lev: 0, pk_time_per_game: 0, pk_time_per_goal_allowed: null,
        sf_per_game: 0, sa_per_game: 0, cf_per_game: 0, ca_per_game: 0, hdf_per_game: 0, hda_per_game: 0,
        sh_pct: 0, sv_pct: 0, engf: 0, enga: 0, en_attempts: 0, ens_pct: 0,
        xgf_per_game: 0, xga_per_game: 0, xgf_pct: 0, gsax: 0, otml: 0,
        time_leading_per_game: 0, time_trailing_per_game: 0, time_tied_per_game: 0, control_score: 1,
        nlw: 0, ntw: 0, ntl: 0, bl: 0, bl_3p: 0, bl_2plus: 0, bl_3plus: 0, cw: 0, cw_3p: 0, cw_2plus: 0, cw_3plus: 0,
    };
}

/**
 * Aggregate one team's games into a table row.
 *
 * Records follow the NHL: in the regular season an OT/SO loss is an "OT"
 * (1 point); in the playoffs every loss is an L and there are no loser points.
 * GF/GA use the standings convention (the shootout winner gets one goal);
 * shooting %, "true" goals and leverage use real goals only.
 *
 * With a period filter, goals/shots/xG/time come from that period's columns.
 * PP/PK and empty-net stats are full-game only and are left at 0.
 */
export function calculateTeamStats(tri: string, games: GameRow[], period: PeriodFilter = 'All'): TeamStat {
    if (games.length === 0) return emptyTeamStat(tri);
    const pi = period === 'All' ? -1 : PERIOD_INDEX[period];
    const pick = (full: number, q: [number, number, number, number]) => (pi < 0 ? full : q[pi]);

    let gp = 0, wins = 0, losses = 0, otl = 0, rw = 0, row = 0;
    let gf = 0, ga = 0, soW = 0, soL = 0;
    let ppg = 0, ppo = 0, ppt = 0, pkga = 0, pko = 0, pkt = 0;
    let sf = 0, sa = 0, cf = 0, ca = 0, hdf = 0, hda = 0, saves = 0;
    let engf = 0, enga = 0, enppgf = 0, enppga = 0, enatt = 0;
    let xgf = 0, xga = 0, xgane = 0, otml = 0;
    let tl = 0, tt = 0, tti = 0, ctrl = 0;
    let nlw = 0, ntw = 0, ntl = 0, bl = 0, bl3p = 0, bl2 = 0, bl3 = 0, cw = 0, cw3p = 0, cw2 = 0, cw3 = 0;

    for (const g of games) {
        gp++;
        const win = isWin(g.result);
        const loss = isLoss(g.result);
        const otLoss = (g.result === 'OTL' || g.result === 'SOL') && g.type === 2;
        if (win) wins++;
        else if (otLoss) otl++;
        else losses++;
        if (g.result === 'RW') rw++;
        if (g.result === 'RW' || g.result === 'OTW') row++;
        if (g.result === 'SOW') soW++;
        if (g.result === 'SOL') soL++;

        gf += pick(g.gf, g.p.gf);
        ga += pick(g.ga, g.p.ga);
        sf += pick(g.sf, g.p.sf);
        sa += pick(g.sa, g.p.sa);
        // Full game uses 5v5 attempts; periods only have all-situation attempts.
        cf += pi < 0 ? g.cf5 : g.p.cf[pi];
        ca += pi < 0 ? g.ca5 : g.p.ca[pi];
        hdf += pick(g.hdf, g.p.hdf);
        hda += pick(g.hda, g.p.hda);
        xgf += pick(g.xgf, g.p.xgf);
        xga += pick(g.xga, g.p.xga);
        // GSAx: full game excludes opponent empty-net xG (xgane).
        xgane += pi < 0 ? (Number.isFinite(g.xgane) ? g.xgane : g.xga) : g.p.xga[pi];
        saves += pi < 0 ? g.saves : Math.max(0, g.p.sa[pi] - g.p.ga[pi]);

        if (pi < 0) {
            ppg += g.ppg; ppo += g.ppo; ppt += g.ppt;
            pkga += g.ppga; pko += g.pko; pkt += g.pkt;
            engf += g.engf; enga += g.enga; enppgf += g.enppgf; enppga += g.enppga; enatt += g.enatt;
        }

        tl += pick(g.tl, g.p.tl);
        tt += pick(g.tt, g.p.tt);
        tti += pick(g.tti, g.p.tti);
        ctrl += pick(g.ctrl, g.p.ctrl);

        if (g.enatt > 0 && g.engf < 1 && loss) otml++;
        if (win && g.tl === 0) nlw++;
        if (win && g.tt === 0) ntw++;
        if (loss && g.tt === 0) ntl++;
        bl += g.bl1; bl2 += g.bl2; bl3 += g.bl3;
        cw += g.cw1; cw2 += g.cw2; cw3 += g.cw3;
        const gf2 = g.p.gf[0] + g.p.gf[1];
        const ga2 = g.p.ga[0] + g.p.ga[1];
        if (loss && gf2 > ga2) bl3p++;
        if (win && gf2 < ga2) cw3p++;
    }

    const points = wins * 2 + otl;
    const soAdj = pi < 0;
    const gfStd = gf + (soAdj ? soW : 0);
    const gaStd = ga + (soAdj ? soL : 0);
    const trueGf = pi < 0 ? gf - ppg - engf + enppgf : gf;
    const trueGa = pi < 0 ? ga - pkga - enga + enppga : ga;

    return {
        tri, gp, wins, losses, otl, points,
        pt_pct: points / (gp * 2),
        rw, row,
        gf: gfStd,
        ga: gaStd,
        gf_per_game: gfStd / gp,
        ga_per_game: gaStd / gp,
        goal_diff: gfStd - gaStd,
        true_goal_diff: trueGf - trueGa,
        true_gf_per_game: trueGf / gp,
        true_ga_per_game: trueGa / gp,
        total_goals_per_game: (gfStd + gaStd) / gp,
        pp_goals: ppg,
        pp_opps: ppo,
        pp_pct: ppo > 0 ? (ppg / ppo) * 100 : 0,
        pp_lev: gf > 0 ? (ppg / gf) * 100 : 0,
        pp_time_per_game: ppt / gp,
        pp_time_per_goal: ppg > 0 ? ppt / ppg : null,
        pk_goals_allowed: pkga,
        pk_opps: pko,
        pk_pct: pko > 0 ? ((pko - pkga) / pko) * 100 : 0,
        pk_lev: ga > 0 ? (pkga / ga) * 100 : 0,
        pk_time_per_game: pkt / gp,
        pk_time_per_goal_allowed: pkga > 0 ? pkt / pkga : null,
        sf_per_game: sf / gp,
        sa_per_game: sa / gp,
        cf_per_game: cf / gp,
        ca_per_game: ca / gp,
        hdf_per_game: hdf / gp,
        hda_per_game: hda / gp,
        sh_pct: sf > 0 ? (gf / sf) * 100 : 0,
        sv_pct: sa - enga > 0 ? (saves / (sa - enga)) * 100 : 0,
        engf, enga,
        en_attempts: enatt,
        ens_pct: enatt > 0 ? (engf / enatt) * 100 : 0,
        xgf_per_game: xgf / gp,
        xga_per_game: xga / gp,
        xgf_pct: xgf + xga > 0 ? (xgf / (xgf + xga)) * 100 : 0,
        gsax: pi < 0 ? xgane - (ga - enga) : xgane - ga,
        otml,
        time_leading_per_game: tl / gp,
        time_trailing_per_game: tt / gp,
        time_tied_per_game: tti / gp,
        control_score: ctrl / gp,
        nlw, ntw, ntl,
        bl, bl_3p: bl3p, bl_2plus: bl2, bl_3plus: bl3,
        cw, cw_3p: cw3p, cw_2plus: cw2, cw_3plus: cw3,
    };
}

/** W-L-OT string. */
export function recordString(s: Pick<TeamStat, 'wins' | 'losses' | 'otl'>): string {
    return `${s.wins}-${s.losses}-${s.otl}`;
}
