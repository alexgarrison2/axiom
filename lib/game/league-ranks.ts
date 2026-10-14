/**
 * League ranks for the Breakdown tab's team stats. Every team's per-game
 * counts for and against come from the Pony Score season file (built with the
 * game page's own code, lib/pony/team-rates.ts); the team's own rate is taken
 * over the games picked in the Breakdown filters and ranked against the
 * other clubs' full-season rates, so a stretch of games reads as "where this
 * would sit in the league". The team's side ranks what it generates
 * (offence), the opponents' side what it allows (defence); 1 is best.
 */

export const RANK_KEYS = ['goals', 'xg', 'sog', 'unblocked', 'attempts', 'hd', 'pp', 'fo', 'hits', 'blocks', 'takeaways', 'giveaways', 'pim'] as const;
export type RankKey = (typeof RANK_KEYS)[number];

/** Counts in RANK_KEYS order: [for, against]. */
export type GameCounts = [number[], number[]];

export interface LeagueRates {
    /** Per team: per-game rates in RANK_KEYS order, for and against. */
    teams: Record<string, { gp: number; for: number[]; ag: number[] }>;
    /** The team's own games (game id → counts), so any subset of them can be ranked. */
    own: Record<number, GameCounts>;
}

/**
 * Which way is better, for the team (offence) and for what it allows (defence).
 * Neutral counts follow the reading a coach would give them: generating hits,
 * blocks and takeaways is good, giveaways and penalty minutes bad; on the
 * allowed side, drawing giveaways and penalties is good.
 */
const BETTER: Record<RankKey, [offence: 'high' | 'low', allowed: 'high' | 'low']> = {
    goals: ['high', 'low'],
    xg: ['high', 'low'],
    sog: ['high', 'low'],
    unblocked: ['high', 'low'],
    attempts: ['high', 'low'],
    hd: ['high', 'low'],
    pp: ['high', 'low'],
    fo: ['high', 'low'],
    hits: ['high', 'low'],
    blocks: ['high', 'low'],
    takeaways: ['high', 'low'],
    giveaways: ['low', 'high'],
    pim: ['low', 'high'],
};

/** Offence and defence ranks (1 = best) of the picked games' per-game rates. Null without data. */
export function leagueRanks(league: LeagueRates, tri: string, gameIds: number[]): { for: Record<RankKey, number>; ag: Record<RankKey, number> } | null {
    const mine = gameIds.map(id => league.own[id]).filter(Boolean);
    if (!mine.length) return null;
    const others = Object.entries(league.teams).filter(([t, r]) => t !== tri && r.gp > 0);
    if (others.length < 8) return null;
    const out = { for: {} as Record<RankKey, number>, ag: {} as Record<RankKey, number> };
    RANK_KEYS.forEach((k, i) => {
        for (const [side, j] of [['for', 0], ['ag', 1]] as const) {
            const v = mine.reduce((a, c) => a + c[j][i], 0) / mine.length;
            const high = BETTER[k][j] === 'high';
            const better = others.filter(([, r]) => (high ? r[side][i] > v + 1e-9 : r[side][i] < v - 1e-9)).length;
            out[side][k] = better + 1;
        }
    });
    return out;
}
