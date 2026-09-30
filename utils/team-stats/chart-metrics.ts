import type { GameRow } from './types';

export interface ChartMetric {
    label: string;
    value: string;
    suffix: string;
    /** Bounded metrics get a fixed y-domain (e.g. points % is always 0–1). */
    domain?: [number, number];
    /** Can go below zero (differentials). */
    signed?: boolean;
    format: (v: number) => string;
}

const MINUS = '−';
const signed1 = (v: number) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1)}`;
const pct3 = (v: number) => v.toFixed(3).replace(/^0+/, '').replace(/^-0+/, '-');

export const CHART_METRICS: ChartMetric[] = [
    { label: 'Points %', value: 'pts_pct', suffix: '', domain: [0, 1], format: pct3 },
    { label: 'Goals for / GP', value: 'gf', suffix: '', format: v => v.toFixed(2) },
    { label: 'Goals against / GP', value: 'ga', suffix: '', format: v => v.toFixed(2) },
    { label: 'Goal differential', value: 'gd', suffix: '', signed: true, format: signed1 },
    { label: 'xGoals for / GP', value: 'xgf', suffix: '', format: v => v.toFixed(2) },
    { label: 'xGoals against / GP', value: 'xga', suffix: '', format: v => v.toFixed(2) },
    { label: 'xG differential', value: 'xgd', suffix: '', signed: true, format: signed1 },
    { label: 'xGF %', value: 'xgf_pct', suffix: '%', domain: [0, 100], format: v => v.toFixed(1) },
    { label: 'High-danger for / GP', value: 'hdf_pg', suffix: '', format: v => v.toFixed(2) },
    { label: 'High-danger against / GP', value: 'hda_pg', suffix: '', format: v => v.toFixed(2) },
    { label: 'High-danger differential', value: 'hd_diff', suffix: '', signed: true, format: signed1 },
    { label: 'Control score', value: 'control', suffix: '', format: v => v.toFixed(3) },
    { label: 'Time leading / GP', value: 'time_leading_pg', suffix: 'm', format: v => v.toFixed(1) },
    { label: 'Time trailing / GP', value: 'time_trailing_pg', suffix: 'm', format: v => v.toFixed(1) },
    { label: 'Power play %', value: 'pp', suffix: '%', domain: [0, 100], format: v => v.toFixed(1) },
    { label: 'Penalty kill %', value: 'pk', suffix: '%', domain: [0, 100], format: v => v.toFixed(1) },
    { label: 'Save %', value: 'sv', suffix: '%', domain: [0, 100], format: v => v.toFixed(1) },
    { label: 'Shooting %', value: 'sh', suffix: '%', domain: [0, 100], format: v => v.toFixed(1) },
    { label: 'Shots for / GP', value: 'sf', suffix: '', format: v => v.toFixed(1) },
    { label: 'Shots against / GP', value: 'sa', suffix: '', format: v => v.toFixed(1) },
    { label: 'Shot differential', value: 'sd', suffix: '', signed: true, format: signed1 },
    { label: 'GSAx / GP', value: 'gsax', suffix: '', signed: true, format: v => v.toFixed(2) },
];

export interface Totals {
    gp: number; pts: number; gf: number; ga: number; xgf: number; xga: number; xgane: number;
    ppg: number; ppo: number; pkg: number; pko: number;
    sf: number; sa: number; cf: number; ca: number; en_ga: number;
    hdf: number; hda: number; tl: number; tt: number; tti: number; ctrl: number;
}

export function buildTotals(games: GameRow[]): Totals {
    const t: Totals = { gp: 0, pts: 0, gf: 0, ga: 0, xgf: 0, xga: 0, xgane: 0, ppg: 0, ppo: 0, pkg: 0, pko: 0, sf: 0, sa: 0, cf: 0, ca: 0, en_ga: 0, hdf: 0, hda: 0, tl: 0, tt: 0, tti: 0, ctrl: 0 };
    for (const g of games) {
        t.gp++;
        t.pts += g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW' ? 2 : (g.result === 'OTL' || g.result === 'SOL') && g.type === 2 ? 1 : 0;
        t.gf += g.gf; t.ga += g.ga; t.xgf += g.xgf; t.xga += g.xga; t.xgane += Number.isFinite(g.xgane) ? g.xgane : g.xga;
        t.ppg += g.ppg; t.ppo += g.ppo; t.pkg += g.ppga; t.pko += g.pko;
        t.sf += g.sf; t.sa += g.sa; t.cf += g.cf; t.ca += g.ca; t.en_ga += g.enga;
        t.hdf += g.hdf; t.hda += g.hda; t.tl += g.tl; t.tt += g.tt; t.tti += g.tti; t.ctrl += g.ctrl;
    }
    return t;
}

export function metricValue(metric: string, t: Totals): number {
    const gp = t.gp;
    if (gp === 0) return NaN;
    switch (metric) {
        case 'pts_pct': return t.pts / (gp * 2);
        case 'gf': return t.gf / gp;
        case 'ga': return t.ga / gp;
        case 'gd': return t.gf - t.ga;
        case 'xgf': return t.xgf / gp;
        case 'xga': return t.xga / gp;
        case 'xgd': return t.xgf - t.xga;
        case 'xgf_pct': return t.xgf + t.xga > 0 ? (t.xgf / (t.xgf + t.xga)) * 100 : NaN;
        case 'hdf_pg': return t.hdf / gp;
        case 'hda_pg': return t.hda / gp;
        case 'hd_diff': return t.hdf - t.hda;
        case 'control': return t.ctrl / gp;
        case 'time_leading_pg': return t.tl / gp / 60;
        case 'time_trailing_pg': return t.tt / gp / 60;
        case 'pp': return t.ppo > 0 ? (t.ppg / t.ppo) * 100 : NaN;
        case 'pk': return t.pko > 0 ? 100 - (t.pkg / t.pko) * 100 : NaN;
        case 'sv': return t.sa - t.en_ga > 0 ? (1 - (t.ga - t.en_ga) / (t.sa - t.en_ga)) * 100 : NaN;
        case 'sh': return t.sf > 0 ? (t.gf / t.sf) * 100 : NaN;
        case 'sf': return t.sf / gp;
        case 'sa': return t.sa / gp;
        case 'sd': return t.sf - t.sa;
        case 'gsax': return (t.xgane - (t.ga - t.en_ga)) / gp;
        default: return NaN;
    }
}

/** League average of every chart metric (per-team-game rates; differentials are 0 by construction). */
export function leagueAverages(games: GameRow[]): Record<string, number> {
    const t = buildTotals(games);
    const out: Record<string, number> = {};
    for (const m of CHART_METRICS) {
        const v = m.signed && m.value !== 'gsax' ? 0 : metricValue(m.value, t);
        out[m.value] = Number.isFinite(v) ? Math.round(v * 10000) / 10000 : NaN;
    }
    return out;
}
