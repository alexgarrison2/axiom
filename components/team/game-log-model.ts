import { filterGames, type GameLevelFilters, type Location, type Scope, type TriState } from '@/utils/team-stats/filter';
import { gsaxOf, isLoss, isWin } from '@/utils/team-stats/game-row';
import type { GameRow, PeriodFilter } from '@/utils/team-stats/types';

export type Recent = 'All' | 5 | 10 | 15 | 20;

export interface TeamGameFilters extends GameLevelFilters {
    scope: Scope;
    location: Location;
    recent: Recent;
    goalie: string; // 'All' or a starter name
    opponent: string; // 'All' or a tricode
    result: 'All' | 'W' | 'L';
    period: PeriodFilter;
}

export const DEFAULT_GAME_FILTERS: TeamGameFilters = {
    scope: 'regular',
    location: 'All',
    recent: 'All',
    goalie: 'All',
    opponent: 'All',
    result: 'All',
    period: 'All',
    ppg: 'All',
    ppga: 'All',
    scoredFirst: 'All',
    ranges: {},
};

export function countGameFilters(f: TeamGameFilters): number {
    let n = 0;
    if (f.scope !== 'regular') n++;
    if (f.location !== 'All') n++;
    if (f.recent !== 'All') n++;
    if (f.goalie !== 'All') n++;
    if (f.opponent !== 'All') n++;
    if (f.result !== 'All') n++;
    if (f.period !== 'All') n++;
    for (const k of ['ppg', 'ppga', 'scoredFirst'] as const) if ((f[k] as TriState) !== 'All') n++;
    n += Object.values(f.ranges).filter(v => v && (v[0] !== '' || v[1] !== '')).length;
    return n;
}

/** Team games (newest first) under the page filters. */
export function applyGameFilters(games: GameRow[], f: TeamGameFilters): GameRow[] {
    let out = games;
    if (f.opponent !== 'All') out = out.filter(g => g.opp === f.opponent);
    if (f.goalie !== 'All') out = out.filter(g => g.starter === f.goalie);
    if (f.result === 'W') out = out.filter(g => isWin(g.result));
    if (f.result === 'L') out = out.filter(g => isLoss(g.result));
    return filterGames(out, { ...f, recent: f.recent === 15 ? 'All' : f.recent, starter: undefined }).slice(0, f.recent === 15 ? 15 : undefined);
}

const PI: Record<Exclude<PeriodFilter, 'All'>, number> = { '1st': 0, '2nd': 1, '3rd': 2, OT: 3 };

type SplitKey = 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'hdf' | 'hda' | 'xgf' | 'xga' | 'tl' | 'tt' | 'tti' | 'ctrl';

/** A stat for one game, respecting the period filter. */
export function stat(g: GameRow, key: SplitKey, period: PeriodFilter): number {
    if (period === 'All') return (g as unknown as Record<string, number>)[key];
    return g.p[key][PI[period]];
}

/** Final score; the shootout winner is credited one goal (full game only), as on NHL.com. */
export function score(g: GameRow, period: PeriodFilter): [number, number] {
    const gf = stat(g, 'gf', period);
    const ga = stat(g, 'ga', period);
    if (period !== 'All') return [gf, ga];
    return [gf + (g.result === 'SOW' ? 1 : 0), ga + (g.result === 'SOL' ? 1 : 0)];
}

export function resultLabel(g: GameRow): string {
    switch (g.result) {
        case 'RW':
            return 'W';
        case 'OTW':
            return 'W OT';
        case 'SOW':
            return 'W SO';
        case 'RL':
            return 'L';
        case 'OTL':
            return g.type === 3 ? 'L OT' : 'OTL';
        case 'SOL':
            return 'SOL';
    }
}

export type ResultTone = 'win' | 'otl' | 'loss';
export function resultTone(g: GameRow): ResultTone {
    if (isWin(g.result)) return 'win';
    if ((g.result === 'OTL' || g.result === 'SOL') && g.type === 2) return 'otl';
    return 'loss';
}

export function flags(g: GameRow) {
    const win = isWin(g.result);
    const loss = isLoss(g.result);
    const gf2 = g.p.gf[0] + g.p.gf[1];
    const ga2 = g.p.ga[0] + g.p.ga[1];
    return {
        nlw: win && g.tl === 0,
        ntw: win && g.tt === 0,
        ntl: loss && g.tt === 0,
        bl: g.bl1 > 0,
        bl3p: loss && gf2 > ga2,
        cw: g.cw1 > 0,
        cw3p: win && gf2 < ga2,
    };
}

export interface Totals {
    gp: number;
    w: number;
    l: number;
    otl: number;
    pts: number;
    gf: number;
    ga: number;
    xgf: number;
    xga: number;
    sf: number;
    sa: number;
    ppg: number;
    ppo: number;
    ppga: number;
    pko: number;
    gsax: number;
}

export function totals(games: GameRow[], period: PeriodFilter): Totals {
    const t: Totals = { gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, xgf: 0, xga: 0, sf: 0, sa: 0, ppg: 0, ppo: 0, ppga: 0, pko: 0, gsax: 0 };
    for (const g of games) {
        t.gp++;
        const tone = resultTone(g);
        if (tone === 'win') t.w++;
        else if (tone === 'otl') t.otl++;
        else t.l++;
        const [gf, ga] = score(g, period);
        t.gf += gf;
        t.ga += ga;
        t.xgf += stat(g, 'xgf', period);
        t.xga += stat(g, 'xga', period);
        t.sf += stat(g, 'sf', period);
        t.sa += stat(g, 'sa', period);
        if (period === 'All') {
            t.ppg += g.ppg;
            t.ppo += g.ppo;
            t.ppga += g.ppga;
            t.pko += g.pko;
        }
        t.gsax += gameGsax(g, period);
    }
    t.pts = t.w * 2 + t.otl;
    return t;
}

/** GSAx for one game: full game excludes opponent empty-net xG; periods use the period split. */
export function gameGsax(g: GameRow, period: PeriodFilter): number {
    return period === 'All' ? gsaxOf(g) : stat(g, 'xga', period) - stat(g, 'ga', period);
}
