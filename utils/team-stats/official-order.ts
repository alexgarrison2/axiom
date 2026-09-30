/* Pure, dependency-free official NHL standings order (client + server + vitest). */

/** The keys the official standings order reads. */
export interface OfficialStandingKeys {
    pts: number;
    gp: number;
    rw: number;
    row: number;
    w: number;
    gd: number;
    gf: number;
}

/**
 * One official NHL order shared by /standings and /teams: points, points %,
 * fewer games played, regulation wins, regulation + OT wins, wins, goal
 * differential, goals for. Returns 0 when every key ties, so a caller can
 * fall back to projections or the tricode. A team that has not played sorts
 * below a team with the same points that has (P% 0 vs undefined is treated
 * as a tie, then fewer GP wins: 0-GP teams rank above an 0-1-0 team).
 */
export function compareOfficial(a: OfficialStandingKeys, b: OfficialStandingKeys): number {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const pa = a.gp ? a.pts / a.gp : 0;
    const pb = b.gp ? b.pts / b.gp : 0;
    if (pb !== pa) return pb - pa;
    if (a.gp !== b.gp) return a.gp - b.gp;
    if (b.rw !== a.rw) return b.rw - a.rw;
    if (b.row !== a.row) return b.row - a.row;
    if (b.w !== a.w) return b.w - a.w;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return 0;
}
